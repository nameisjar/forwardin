import PDFDocument from 'pdfkit';
import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import fs from 'fs/promises';
import logger from '../config/logger';

interface MonthlyFeedbackData {
    studentName: string;
    courseName: string;
    month: number;
    duration: string;
    level: string;
    code: string;
    topicModule: string;
    result: string;
    skillsAcquired: string;
    youtubeLink: string;
    referralLink: string;
    tutorComment: string;
    rating?: number;
    reportBy?: string;
}

// ============================================
// 🔥 MUTEX/LOCK SYSTEM - Mencegah Race Condition
// ============================================

class Mutex {
    private locked: boolean = false;
    private queue: Array<() => void> = [];

    async acquire(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.locked) {
                this.locked = true;
                resolve();
            } else {
                this.queue.push(resolve);
            }
        });
    }

    release(): void {
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            if (next) next();
        } else {
            this.locked = false;
        }
    }

    async withLock<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }

    isLocked(): boolean {
        return this.locked;
    }

    getQueueLength(): number {
        return this.queue.length;
    }
}

// Global mutex untuk operasi browser
const browserMutex = new Mutex();

// ============================================
// 🔥 CONCURRENCY QUEUE SYSTEM
// ============================================

interface QueueItem {
    id: string;
    task: () => Promise<Buffer>;
    resolve: (value: Buffer) => void;
    reject: (error: Error) => void;
    addedAt: number;
}

class PDFGeneratorQueue {
    private queue: QueueItem[] = [];
    private activeCount: number = 0;
    private readonly maxConcurrent: number;
    private readonly maxQueueSize: number;
    private readonly queueTimeout: number;
    private processedCount: number = 0;
    private failedCount: number = 0;
    private isShuttingDown: boolean = false;

    constructor(options?: { maxConcurrent?: number; maxQueueSize?: number; queueTimeout?: number }) {
        this.maxConcurrent = options?.maxConcurrent ?? 10;
        this.maxQueueSize = options?.maxQueueSize ?? 500;
        this.queueTimeout = options?.queueTimeout ?? 300000;
        
        logger.info(`[PDFQueue] Initialized (concurrent: ${this.maxConcurrent}, maxQueue: ${this.maxQueueSize})`);
    }

    async add(task: () => Promise<Buffer>, taskId?: string): Promise<Buffer> {
        const id = taskId || `pdf-${Date.now()}`;
        
        // Reject new tasks if shutting down
        if (this.isShuttingDown) {
            throw new Error('Server sedang restart, silakan coba lagi dalam beberapa saat');
        }
        
        if (this.queue.length >= this.maxQueueSize) {
            logger.error(`[PDFQueue] Queue full (${this.queue.length}/${this.maxQueueSize})`);
            throw new Error('Server sedang sibuk, silakan coba lagi dalam beberapa menit');
        }

        // Only log if queue is building up (> 5 items)
        if (this.queue.length > 5) {
            logger.info(`[PDFQueue] Queue: ${this.queue.length}, Active: ${this.activeCount}/${this.maxConcurrent}`);
        }

        return new Promise<Buffer>((resolve, reject) => {
            const item: QueueItem = {
                id,
                task,
                resolve,
                reject,
                addedAt: Date.now()
            };

            this.queue.push(item);
            
            const timeoutId = setTimeout(() => {
                const index = this.queue.findIndex(q => q.id === id);
                if (index !== -1) {
                    this.queue.splice(index, 1);
                    logger.warn(`[PDFQueue] Task timeout: ${id}`);
                    reject(new Error('Request timeout - server sedang sibuk'));
                }
            }, this.queueTimeout);

            const originalResolve = item.resolve;
            const originalReject = item.reject;
            
            item.resolve = (value: Buffer) => {
                clearTimeout(timeoutId);
                originalResolve(value);
            };
            
            item.reject = (error: Error) => {
                clearTimeout(timeoutId);
                originalReject(error);
            };

            this.processQueue();
        });
    }

    private async processQueue(): Promise<void> {
        if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
            return;
        }

        const item = this.queue.shift();
        if (!item) return;

        this.activeCount++;

        try {
            const result = await item.task();
            this.processedCount++;
            item.resolve(result);
        } catch (error) {
            this.failedCount++;
            logger.error(`[PDFQueue] Task failed (total failed: ${this.failedCount})`);
            item.reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
            this.activeCount--;
            this.processQueue();
        }
    }

    /**
     * Graceful shutdown - reject semua queue dan tunggu active tasks selesai
     * @param timeoutMs - maksimal waktu tunggu (default 30 detik)
     */
    async shutdown(timeoutMs: number = 30000): Promise<void> {
        if (this.isShuttingDown) return;
        
        this.isShuttingDown = true;
        logger.info(`[PDFQueue] Shutting down... (queue: ${this.queue.length}, active: ${this.activeCount})`);
        
        // Reject semua items di queue
        const queuedItems = [...this.queue];
        this.queue = [];
        
        for (const item of queuedItems) {
            item.reject(new Error('Server sedang restart, silakan coba lagi'));
        }
        
        if (queuedItems.length > 0) {
            logger.info(`[PDFQueue] Rejected ${queuedItems.length} queued tasks`);
        }
        
        // Tunggu active tasks selesai (dengan timeout)
        if (this.activeCount > 0) {
            logger.info(`[PDFQueue] Waiting for ${this.activeCount} active tasks to complete...`);
            
            const startTime = Date.now();
            while (this.activeCount > 0 && (Date.now() - startTime) < timeoutMs) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            if (this.activeCount > 0) {
                logger.warn(`[PDFQueue] Shutdown timeout - ${this.activeCount} tasks still running`);
            } else {
                logger.info('[PDFQueue] All active tasks completed');
            }
        }
        
        logger.info(`[PDFQueue] Shutdown complete (processed: ${this.processedCount}, failed: ${this.failedCount})`);
    }

    getStats() {
        return {
            queueLength: this.queue.length,
            activeCount: this.activeCount,
            maxConcurrent: this.maxConcurrent,
            processedCount: this.processedCount,
            failedCount: this.failedCount,
            isShuttingDown: this.isShuttingDown
        };
    }
}

// Global queue instance
const pdfQueue = new PDFGeneratorQueue({
    maxConcurrent: 10,     // Process max 10 PDFs simultaneously
    maxQueueSize: 500,     // Max 500 requests waiting (supports 300+ users)
    queueTimeout: 300000   // 5 minutes timeout (300 seconds)
});

// Export for monitoring
export const getPDFQueueStats = () => pdfQueue.getStats();

// Export for graceful shutdown
export const shutdownPDFQueue = (timeoutMs?: number) => pdfQueue.shutdown(timeoutMs);

// ============================================
// 🔥 PUPPETEER OPTIMIZATION: Browser Pool
// ============================================

let browserInstance: Browser | null = null;
let browserLastUsed: number = 0;
const BROWSER_IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const MAX_BROWSER_AGE = 30 * 60 * 1000; // 30 minutes - force restart after this
let browserCreatedAt: number = 0;

/**
 * Get or create a browser instance (singleton pattern with auto-cleanup)
 * Uses mutex to prevent race condition
 */
const getBrowser = async (): Promise<Browser> => {
    return browserMutex.withLock(async () => {
        const now = Date.now();
        
        // Check if browser needs restart (too old or disconnected)
        if (browserInstance) {
            const browserAge = now - browserCreatedAt;
            const isConnected = browserInstance.isConnected();
            
            if (!isConnected || browserAge > MAX_BROWSER_AGE) {
                logger.info(`[Puppeteer] Browser restart needed - Connected: ${isConnected}, Age: ${Math.round(browserAge/1000)}s`);
                await closeBrowserInternal();
            }
        }
        
        // Create new browser if needed
        if (!browserInstance) {
            logger.info('[Puppeteer] Launching browser...');
            
            const isLinux = process.platform === 'linux';
            
            const baseArgs = [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-extensions',
                '--disable-plugins',
                '--disable-sync',
                '--disable-translate',
                '--disable-default-apps',
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-breakpad',
                '--disable-component-update',
                '--disable-domain-reliability',
                '--disable-features=TranslateUI',
                '--disable-hang-monitor',
                '--disable-ipc-flooding-protection',
                '--disable-popup-blocking',
                '--disable-prompt-on-repost',
                '--disable-renderer-backgrounding',
                '--disable-client-side-phishing-detection',
                '--no-first-run',
                '--memory-pressure-off',
            ];
            
            const linuxArgs = isLinux ? ['--no-zygote', '--single-process'] : [];
            const allArgs = [...baseArgs, ...linuxArgs];
            
            try {
                browserInstance = await puppeteer.launch({
                    headless: true,
                    args: allArgs,
                    timeout: 60000,
                    ignoreDefaultArgs: ['--enable-automation'],
                });
                
                browserCreatedAt = now;
                logger.info(`[Puppeteer] Browser launched (${process.platform})`);
                
                browserInstance.on('disconnected', () => {
                    logger.warn('[Puppeteer] Browser disconnected');
                    browserInstance = null;
                });
            } catch (launchError) {
                logger.error('[Puppeteer] Browser launch failed:', launchError instanceof Error ? launchError.message : String(launchError));
                throw launchError;
            }
        }
        
        browserLastUsed = now;
        return browserInstance;
    });
};

/**
 * Internal close browser (without mutex - called from within mutex)
 */
const closeBrowserInternal = async (): Promise<void> => {
    if (browserInstance) {
        try {
            logger.info('[Puppeteer] Closing browser instance...');
            await browserInstance.close();
        } catch (error) {
            logger.warn('[Puppeteer] Error closing browser:', error);
        } finally {
            browserInstance = null;
        }
    }
};

/**
 * Close browser instance (with mutex - safe to call from outside)
 */
const closeBrowser = async (): Promise<void> => {
    await browserMutex.withLock(async () => {
        await closeBrowserInternal();
    });
};

/**
 * Auto-cleanup idle browser (call this periodically or on app shutdown)
 */
export const cleanupIdleBrowser = async (): Promise<void> => {
    if (browserInstance && Date.now() - browserLastUsed > BROWSER_IDLE_TIMEOUT) {
        logger.info('[Puppeteer] Cleaning up idle browser...');
        await closeBrowser();
    }
};

// Setup periodic cleanup (every 2 minutes)
setInterval(cleanupIdleBrowser, 2 * 60 * 1000);

// Cleanup on process exit with graceful shutdown
process.on('exit', () => closeBrowser());

process.on('SIGINT', async () => {
    logger.info('[Server] SIGINT received - starting graceful shutdown...');
    await shutdownPDFQueue(30000); // Wait max 30 seconds for queue
    await closeBrowser();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('[Server] SIGTERM received - starting graceful shutdown...');
    await shutdownPDFQueue(30000); // Wait max 30 seconds for queue
    await closeBrowser();
    process.exit(0);
});

// ============================================
// 🔥 HELPER FUNCTIONS
// ============================================

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================
// 🔥 TEMPLATE CACHING
// ============================================

let cachedTemplate: string | null = null;
let cachedImages: Record<string, string> | null = null;
let cacheLoadedAt: number = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

const loadTemplateAndImages = async (): Promise<{ template: string; images: Record<string, string> }> => {
    const now = Date.now();
    
    // Return cached if still valid (no logging for cache hit - too verbose)
    if (cachedTemplate && cachedImages && (now - cacheLoadedAt) < CACHE_TTL) {
        return { template: cachedTemplate, images: cachedImages };
    }
    
    logger.info('[Puppeteer] Loading template and images (cache miss or expired)...');
    
    // Try multiple paths to find templates
    const templatesPaths = [
        path.join(__dirname, '../../templates'),
        path.join(process.cwd(), 'templates'),
    ];
    
    let templatePath = '';
    let imagesPath = '';
    let foundPath = false;
    
    for (const basePath of templatesPaths) {
        const tryTemplatePath = path.join(basePath, 'monthly-feedback-template.html');
        const tryImagesPath = path.join(basePath, 'images-base64.json');
        
        try {
            await fs.access(tryTemplatePath);
            await fs.access(tryImagesPath);
            templatePath = tryTemplatePath;
            imagesPath = tryImagesPath;
            foundPath = true;
            logger.info(`[Puppeteer] Found templates at: ${basePath}`);
            break;
        } catch {
            // Silent - will try next path
        }
    }
    
    if (!foundPath) {
        const errorMsg = `Template files not found. __dirname: ${__dirname}, cwd: ${process.cwd()}`;
        logger.error('[Puppeteer] ' + errorMsg);
        throw new Error(errorMsg);
    }
    
    const [template, imagesJson] = await Promise.all([
        fs.readFile(templatePath, 'utf-8'),
        fs.readFile(imagesPath, 'utf-8')
    ]);
    
    cachedTemplate = template;
    cachedImages = JSON.parse(imagesJson) as Record<string, string>;
    cacheLoadedAt = now;
    
    logger.info(`[Puppeteer] Template cached (${template.length} chars, ${Object.keys(cachedImages).length} images)`);
    
    return { template: cachedTemplate, images: cachedImages };
};

// ============================================
// 🔥 MAIN PDF GENERATION (OPTIMIZED WITH RETRY)
// ============================================

/**
 * Internal function to generate PDF (used by retry mechanism)
 */
const generatePDFInternal = async (data: MonthlyFeedbackData): Promise<Buffer> => {
    const startTime = Date.now();
    // 🔒 Log tanpa nama student lengkap (privacy)
    logger.info('[Puppeteer] Starting PDF generation', { 
        studentId: data.studentName ? `${data.studentName.substring(0, 2)}***` : 'unknown',
        courseName: data.courseName,
        month: data.month 
    });
    
    let page: Page | null = null;
    
    try {
        // Load template and images (cached)
        const { template, images } = await loadTemplateAndImages();
        
        // Replace placeholders
        let htmlContent = template
            .replace(/\{\{studentName\}\}/g, escapeHtml(data.studentName))
            .replace(/\{\{courseName\}\}/g, escapeHtml(data.courseName))
            .replace(/\{\{duration\}\}/g, escapeHtml(data.duration))
            .replace(/\{\{level\}\}/g, escapeHtml(data.level))
            .replace(/\{\{month\}\}/g, String(data.month))
            .replace(/\{\{code\}\}/g, escapeHtml(data.code))
            .replace(/\{\{topicModule\}\}/g, escapeHtml(data.topicModule))
            .replace(/\{\{result\}\}/g, escapeHtml(data.result))
            .replace(/\{\{skillsAcquired\}\}/g, escapeHtml(data.skillsAcquired))
            .replace(/\{\{youtubeLink\}\}/g, escapeHtml(data.youtubeLink))
            .replace(/\{\{referralLink\}\}/g, escapeHtml(data.referralLink))
            .replace(/\{\{tutorComment\}\}/g, escapeHtml(data.tutorComment))
            .replace(/\{\{rating\}\}/g, String(data.rating || 5))
            .replace(/\{\{reportBy\}\}/g, escapeHtml(data.reportBy || 'Tutor'))
            // Images
            .replace(/\{\{headerImage\}\}/g, images.cellImage_1836760394_0 || '')
            .replace(/\{\{educationPathImage\}\}/g, images.gambar_jalur_pendidikan || '')
            // Icons
            .replace(/\{\{trophyIcon\}\}/g, images.cellImage_1836760394_1 || '')
            .replace(/\{\{linkIcon\}\}/g, images.cellImage_1836760394_8 || '')
            .replace(/\{\{skillsIcon\}\}/g, images.cellImage_1836760394_6 || '')
            .replace(/\{\{freeLessonGiftIcon\}\}/g, images.cellImage_1836760394_3 || '')
            .replace(/\{\{aboutModuleIcon\}\}/g, images.cellImage_1836760394_5 || '')
            .replace(/\{\{feedbackIcon\}\}/g, images.cellImage_1836760394_7 || '');
        
        // Get browser (pooled)
        const browser = await getBrowser();
        
        // Create new page
        page = await browser.newPage();
        
        // Set viewport
        await page.setViewport({ 
            width: 794, 
            height: 1123,
            deviceScaleFactor: 2 // Higher quality
        });
        
        // Set content with timeout
        await page.setContent(htmlContent, { 
            waitUntil: 'networkidle0',
            timeout: 30000 // 30 second timeout
        });
        
        // Wait for all images to load
        await page.evaluate(() => {
            return Promise.all(
                Array.from(document.images)
                    .filter(img => !img.complete)
                    .map(img => new Promise(resolve => {
                        img.onload = img.onerror = resolve;
                    }))
            );
        });
        
        // Small delay to ensure rendering is complete
        await sleep(300);
        
        // Generate PDF
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '0mm',
                bottom: '0mm',
                left: '0mm',
                right: '0mm'
            },
            timeout: 30000 // 30 second timeout
        });
        
        const duration = Date.now() - startTime;
        logger.info(`[Puppeteer] PDF generated successfully in ${duration}ms, size: ${pdfBuffer.length} bytes`);
        
        return Buffer.from(pdfBuffer);
        
    } finally {
        // Always close the page (but keep browser open)
        if (page) {
            try {
                await page.close();
            } catch (e) {
                logger.warn('[Puppeteer] Error closing page:', e);
            }
        }
    }
};

/**
 * Generate PDF using Puppeteer with SMART RETRY mechanism
 * - Attempt 1-2: Retry tanpa restart browser (mungkin hanya page yang bermasalah)
 * - Attempt 3-5: Retry dengan restart browser (browser mungkin bermasalah)
 */
export const generateMonthlyFeedbackPDFWithPuppeteer = async (data: MonthlyFeedbackData): Promise<Buffer> => {
    return pdfQueue.add(async () => {
        const maxRetries = 5;
        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Only log attempt number if it's a retry
                if (attempt > 1) {
                    logger.info(`[Puppeteer] Retry ${attempt}/${maxRetries} for: ${data.studentName?.substring(0, 2)}***`);
                }
                
                const result = await generatePDFInternal(data);
                
                // Log success only if it was a retry
                if (attempt > 1) {
                    logger.info(`[Puppeteer] ✅ Succeeded on retry ${attempt} for: ${data.studentName?.substring(0, 2)}***`);
                }
                
                return result;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                logger.warn(`[Puppeteer] Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
                
                if (attempt < maxRetries) {
                    // Smart retry strategy
                    if (attempt >= 2) {
                        await closeBrowser();
                    }
                    
                    const waitTime = attempt <= 2 ? 500 : (attempt - 1) * 1000;
                    await sleep(waitTime);
                }
            }
        }
        
        // All retries failed
        logger.error(`[Puppeteer] All ${maxRetries} attempts failed for: ${data.studentName?.substring(0, 2)}*** - ${lastError?.message}`);
        throw lastError || new Error('PDF generation failed after all retries');
    }, `pdf-${data.studentName?.substring(0, 2)}***-${Date.now()}`);
};

/**
 * Pre-warm the browser (call this on server startup)
 * This ensures browser is ready before first request
 */
export const warmupBrowser = async (): Promise<void> => {
    try {
        logger.info('[Puppeteer] Warming up browser...');
        const browser = await getBrowser();
        
        // Create and close a test page to ensure browser is fully ready
        const page = await browser.newPage();
        await page.setContent('<html><body>Warmup</body></html>');
        await page.close();
        
        logger.info('[Puppeteer] Browser warmed up successfully');
    } catch (error) {
        logger.error('[Puppeteer] Browser warmup failed:', error);
        // Don't throw - warmup failure shouldn't crash the app
    }
};

/**
 * Escape HTML special characters to prevent XSS
 */
const escapeHtml = (str: string): string => {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

// ============================================
// 📦 BACKUP: PDFKit Generator (Simple Template)
// ============================================
// 
// Fungsi ini adalah BACKUP jika Puppeteer benar-benar tidak bisa jalan.
// Template ini lebih sederhana (text-based) dibanding Puppeteer (HTML template).
// 
// KAPAN DIGUNAKAN:
// - Jika server tidak support Chromium/Puppeteer
// - Untuk debugging/testing tanpa Puppeteer
// 
// CARA MENGGUNAKAN (manual):
// 1. Import: import { generateMonthlyFeedbackPDF } from './pdfGenerator'
// 2. Panggil: const pdf = await generateMonthlyFeedbackPDF(data)
//
// CATATAN: Fungsi ini TIDAK dipanggil otomatis. 
// generateMonthlyFeedbackPDFWithPuppeteer sudah punya retry mechanism.
// ============================================

export const generateMonthlyFeedbackPDF = async (data: MonthlyFeedbackData): Promise<Buffer> => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                margins: {
                    top: 50,
                    bottom: 50,
                    left: 50,
                    right: 50
                }
            });

            const chunks: Buffer[] = [];

            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // Header
            doc.fontSize(24)
               .fillColor('#3B82F6')
               .text('FEEDBACK BULANAN', { align: 'center' })
               .moveDown(0.5);

            doc.fontSize(16)
               .fillColor('#64748B')
               .text('Algorithmics Programming School', { align: 'center' })
               .moveDown(2);

            // Student Info Section
            doc.fontSize(14)
               .fillColor('#1E293B')
               .text('Informasi Siswa', { underline: true })
               .moveDown(0.5);

            const infoFields = [
                ['Nama Siswa', data.studentName],
                ['Nama Kursus', data.courseName],
                ['Lama Pelatihan', data.duration],
                ['Level', data.level],
                ['Code', data.code]
            ];

            doc.fontSize(11).fillColor('#475569');
            infoFields.forEach(([label, value]) => {
                doc.text(`${label}: `, { continued: true, width: 150 })
                   .fillColor('#1E293B')
                   .text(value || '-')
                   .fillColor('#475569')
                   .moveDown(0.3);
            });

            doc.moveDown(1);

            // Learning Material Section
            doc.fontSize(14)
               .fillColor('#1E293B')
               .text('Materi Pembelajaran', { underline: true })
               .moveDown(0.5);

            doc.fontSize(11)
               .fillColor('#475569')
               .text('Topik Modul:', { underline: true })
               .moveDown(0.3)
               .fillColor('#334155')
               .text(data.topicModule || '-', { align: 'justify' })
               .moveDown(0.5);

            doc.fillColor('#475569')
               .text('Hasil:', { underline: true })
               .moveDown(0.3)
               .fillColor('#334155')
               .text(data.result || '-', { align: 'justify' })
               .moveDown(0.5);

            doc.fillColor('#475569')
               .text('Keahlian yang Didapatkan:', { underline: true })
               .moveDown(0.3)
               .fillColor('#334155')
               .text(data.skillsAcquired || '-', { align: 'justify' })
               .moveDown(1);

            // Tutor Feedback Section
            doc.fontSize(14)
               .fillColor('#1E293B')
               .text('Feedback Tutor', { underline: true })
               .moveDown(0.5);

            doc.fontSize(11)
               .fillColor('#334155')
               .text(data.tutorComment, { align: 'justify' })
               .moveDown(1);

            // Links Section
            doc.fontSize(14)
               .fillColor('#1E293B')
               .text('Tautan Penting', { underline: true })
               .moveDown(0.5);

            doc.fontSize(11)
               .fillColor('#475569')
               .text('Video Proyek Akhir:', { continued: true })
               .fillColor('#3B82F6')
               .text(` ${data.youtubeLink}`, { link: data.youtubeLink })
               .moveDown(0.3);

            doc.fillColor('#475569')
               .text('Link Referral Tutor:', { continued: true })
               .fillColor('#3B82F6')
               .text(` ${data.referralLink}`, { link: data.referralLink })
               .moveDown(2);

            // Footer
            const currentDate = new Date().toLocaleDateString('id-ID', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            doc.fontSize(9)
               .fillColor('#94A3B8')
               .text(`Dibuat pada: ${currentDate}`, { align: 'center' })
               .moveDown(0.3)
               .text('© 2024 Algorithmics Programming School', { align: 'center' });

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};

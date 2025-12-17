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

    constructor(options?: { maxConcurrent?: number; maxQueueSize?: number; queueTimeout?: number }) {
        this.maxConcurrent = options?.maxConcurrent ?? 10;   // Max 10 PDF generations at once
        this.maxQueueSize = options?.maxQueueSize ?? 500;    // Max 500 items in queue
        this.queueTimeout = options?.queueTimeout ?? 300000; // 5 minutes timeout for queue wait
        
        logger.info(`[PDFQueue] Initialized - maxConcurrent: ${this.maxConcurrent}, maxQueueSize: ${this.maxQueueSize}, timeout: ${this.queueTimeout}ms`);
    }

    async add(task: () => Promise<Buffer>, taskId?: string): Promise<Buffer> {
        const id = taskId || `pdf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Check queue size limit
        if (this.queue.length >= this.maxQueueSize) {
            logger.error(`[PDFQueue] Queue full (${this.queue.length}/${this.maxQueueSize}), rejecting task ${id}`);
            throw new Error('Server sedang sibuk, silakan coba lagi dalam beberapa menit');
        }

        logger.info(`[PDFQueue] Adding task ${id} - Queue: ${this.queue.length}, Active: ${this.activeCount}/${this.maxConcurrent}`);

        return new Promise<Buffer>((resolve, reject) => {
            const item: QueueItem = {
                id,
                task,
                resolve,
                reject,
                addedAt: Date.now()
            };

            this.queue.push(item);
            
            // Set timeout for queue wait
            const timeoutId = setTimeout(() => {
                const index = this.queue.findIndex(q => q.id === id);
                if (index !== -1) {
                    this.queue.splice(index, 1);
                    logger.warn(`[PDFQueue] Task ${id} timed out after waiting in queue`);
                    reject(new Error('Request timeout - server sedang sibuk'));
                }
            }, this.queueTimeout);

            // Store timeout ID to clear it later
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
        // Check if we can process more
        if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
            return;
        }

        // Get next item from queue
        const item = this.queue.shift();
        if (!item) return;

        this.activeCount++;
        const waitTime = Date.now() - item.addedAt;
        logger.info(`[PDFQueue] Processing task ${item.id} - waited ${waitTime}ms, Active: ${this.activeCount}/${this.maxConcurrent}, Remaining: ${this.queue.length}`);

        try {
            const result = await item.task();
            this.processedCount++;
            logger.info(`[PDFQueue] Task ${item.id} completed successfully. Total processed: ${this.processedCount}`);
            item.resolve(result);
        } catch (error) {
            this.failedCount++;
            logger.error(`[PDFQueue] Task ${item.id} failed. Total failed: ${this.failedCount}`, error);
            item.reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
            this.activeCount--;
            // Process next item in queue
            this.processQueue();
        }
    }

    getStats() {
        return {
            queueLength: this.queue.length,
            activeCount: this.activeCount,
            maxConcurrent: this.maxConcurrent,
            processedCount: this.processedCount,
            failedCount: this.failedCount
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
 */
const getBrowser = async (): Promise<Browser> => {
    const now = Date.now();
    
    // Check if browser needs restart (too old or disconnected)
    if (browserInstance) {
        const browserAge = now - browserCreatedAt;
        const isConnected = browserInstance.isConnected();
        
        if (!isConnected || browserAge > MAX_BROWSER_AGE) {
            logger.info(`[Puppeteer] Browser needs restart - Connected: ${isConnected}, Age: ${Math.round(browserAge/1000)}s`);
            await closeBrowser();
        }
    }
    
    // Create new browser if needed
    if (!browserInstance) {
        logger.info('[Puppeteer] Launching new browser instance...');
        
        // Detect OS for platform-specific args
        const isWindows = process.platform === 'win32';
        const isLinux = process.platform === 'linux';
        
        logger.info(`[Puppeteer] Platform: ${process.platform}, isWindows: ${isWindows}, isLinux: ${isLinux}`);
        
        // Base args that work on all platforms
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
        
        // Linux/Docker specific args (NOT for Windows)
        const linuxArgs = isLinux ? [
            '--no-zygote',
            '--single-process',
        ] : [];
        
        const allArgs = [...baseArgs, ...linuxArgs];
        
        logger.info('[Puppeteer] Launch args:', allArgs.join(', '));
        
        try {
            browserInstance = await puppeteer.launch({
                headless: true,
                args: allArgs,
                timeout: 60000,
                ignoreDefaultArgs: ['--enable-automation'],
            });
            
            browserCreatedAt = now;
            logger.info('[Puppeteer] Browser launched successfully');
            
            // Handle browser disconnect
            browserInstance.on('disconnected', () => {
                logger.warn('[Puppeteer] Browser disconnected unexpectedly');
                browserInstance = null;
            });
        } catch (launchError) {
            logger.error('[Puppeteer] Failed to launch browser:', launchError);
            logger.error('[Puppeteer] Launch error message:', launchError instanceof Error ? launchError.message : String(launchError));
            logger.error('[Puppeteer] Launch error stack:', launchError instanceof Error ? launchError.stack : 'No stack');
            throw launchError;
        }
    }
    
    browserLastUsed = now;
    return browserInstance;
};

/**
 * Close browser instance
 */
const closeBrowser = async (): Promise<void> => {
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

// Cleanup on process exit
process.on('exit', () => closeBrowser());
process.on('SIGINT', async () => {
    await closeBrowser();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    await closeBrowser();
    process.exit(0);
});

// ============================================
// 🔥 RETRY MECHANISM
// ============================================

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const withRetry = async <T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000,
    operationName: string = 'operation'
): Promise<T> => {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;
            logger.warn(`[Puppeteer] ${operationName} failed (attempt ${attempt}/${maxRetries}):`, lastError.message);
            
            if (attempt < maxRetries) {
                // Force browser restart on retry
                await closeBrowser();
                await sleep(delayMs * attempt); // Exponential backoff
            }
        }
    }
    
    throw lastError;
};

// ============================================
// 🔥 TEMPLATE CACHING
// ============================================

let cachedTemplate: string | null = null;
let cachedImages: Record<string, string> | null = null;
let cacheLoadedAt: number = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Get the correct templates directory path
 * Works both in development (src/) and production (dist/)
 */
const getTemplatesPath = (): string => {
    // Try multiple possible paths
    const possiblePaths = [
        // From dist/services/ -> templates/
        path.join(__dirname, '../../templates'),
        // From src/services/ -> templates/
        path.join(__dirname, '../../templates'),
        // From project root
        path.join(process.cwd(), 'templates'),
        // Absolute path fallback
        path.resolve('templates'),
    ];
    
    logger.info('[Puppeteer] __dirname:', __dirname);
    logger.info('[Puppeteer] process.cwd():', process.cwd());
    logger.info('[Puppeteer] Checking template paths:', possiblePaths);
    
    return possiblePaths[0]; // Primary path
};

const loadTemplateAndImages = async (): Promise<{ template: string; images: Record<string, string> }> => {
    const now = Date.now();
    
    // Return cached if still valid
    if (cachedTemplate && cachedImages && (now - cacheLoadedAt) < CACHE_TTL) {
        logger.info('[Puppeteer] Using cached template and images');
        return { template: cachedTemplate, images: cachedImages };
    }
    
    logger.info('[Puppeteer] Loading template and images...');
    
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
        
        logger.info(`[Puppeteer] Trying path: ${basePath}`);
        
        try {
            await fs.access(tryTemplatePath);
            await fs.access(tryImagesPath);
            templatePath = tryTemplatePath;
            imagesPath = tryImagesPath;
            foundPath = true;
            logger.info(`[Puppeteer] ✅ Found templates at: ${basePath}`);
            break;
        } catch {
            logger.warn(`[Puppeteer] ❌ Templates not found at: ${basePath}`);
        }
    }
    
    if (!foundPath) {
        const errorMsg = `Template files not found. Tried paths: ${templatesPaths.join(', ')}. __dirname: ${__dirname}, cwd: ${process.cwd()}`;
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
    
    logger.info('[Puppeteer] Template and images loaded successfully');
    logger.info('[Puppeteer] Template length:', template.length, 'chars');
    logger.info('[Puppeteer] Images keys:', Object.keys(cachedImages).length);
    
    return { template: cachedTemplate, images: cachedImages };
};

// ============================================
// 🔥 MAIN PDF GENERATION (OPTIMIZED)
// ============================================

/**
 * Generate PDF using Puppeteer (renders HTML to PDF)
 * OPTIMIZED: Browser pooling, retry mechanism, better error handling
 */
export const generateMonthlyFeedbackPDFWithPuppeteer = async (data: MonthlyFeedbackData): Promise<Buffer> => {
    return pdfQueue.add(async () => {
        const startTime = Date.now();
        logger.info('[Puppeteer] Starting PDF generation for:', data.studentName);
        
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
            await sleep(500);
            
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
    });
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

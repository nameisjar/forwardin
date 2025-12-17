import logger from '../config/logger';

// ============================================
// 🔥 SMART RATE LIMITER PER DEVICE
// ============================================
// 
// Mencegah WhatsApp ban dengan membatasi jumlah pesan per device.
// Mendukung 2 skenario:
// - Shared Device (300 tutor pakai 1 device) → limit ketat
// - Personal Device (1 tutor 1 device) → limit longgar
// ============================================

interface RateLimitConfig {
    maxPerMinute: number;      // Max pesan per menit
    maxPerHour: number;        // Max pesan per jam
    minDelayMs: number;        // Minimum delay antar pesan (ms)
}

interface DeviceStats {
    minuteCount: number;       // Jumlah pesan di menit ini
    hourCount: number;         // Jumlah pesan di jam ini
    minuteResetAt: number;     // Timestamp reset menit
    hourResetAt: number;       // Timestamp reset jam
    lastSentAt: number;        // Timestamp pesan terakhir
    queueLength: number;       // Jumlah pesan dalam antrian
}

interface QueueItem {
    id: string;
    deviceId: string;
    execute: () => Promise<void>;
    resolve: (result: RateLimitResult) => void;
    reject: (error: Error) => void;
    addedAt: number;
}

export interface RateLimitResult {
    allowed: boolean;
    delayed: boolean;
    delayMs: number;
    estimatedSendTime: Date;
    queuePosition: number;
    message: string;
}

// Default config untuk shared device (konservatif)
const DEFAULT_CONFIG: RateLimitConfig = {
    maxPerMinute: 20,          // 20 pesan/menit
    maxPerHour: 500,           // 500 pesan/jam
    minDelayMs: 3000,          // Minimum 3 detik antar pesan
};

// Config untuk personal device (lebih longgar)
const PERSONAL_DEVICE_CONFIG: RateLimitConfig = {
    maxPerMinute: 10,
    maxPerHour: 100,
    minDelayMs: 2000,
};

class DeviceRateLimiter {
    private deviceStats: Map<string, DeviceStats> = new Map();
    private deviceConfigs: Map<string, RateLimitConfig> = new Map();
    private deviceQueues: Map<string, QueueItem[]> = new Map();
    private processingDevices: Set<string> = new Set();
    private isShuttingDown: boolean = false;

    // Statistik global
    private totalProcessed: number = 0;
    private totalDelayed: number = 0;
    private totalRejected: number = 0;

    constructor() {
        logger.info('[RateLimiter] Initialized');
        
        // Cleanup old stats setiap 5 menit
        setInterval(() => this.cleanupOldStats(), 5 * 60 * 1000);
    }

    /**
     * Set config khusus untuk device tertentu
     */
    setDeviceConfig(deviceId: string, config: Partial<RateLimitConfig>): void {
        const currentConfig = this.deviceConfigs.get(deviceId) || { ...DEFAULT_CONFIG };
        this.deviceConfigs.set(deviceId, { ...currentConfig, ...config });
        logger.info(`[RateLimiter] Config updated for device ${deviceId}:`, config);
    }

    /**
     * Set device sebagai personal (limit lebih longgar)
     */
    setAsPersonalDevice(deviceId: string): void {
        this.deviceConfigs.set(deviceId, { ...PERSONAL_DEVICE_CONFIG });
        logger.info(`[RateLimiter] Device ${deviceId} set as personal device`);
    }

    /**
     * Set device sebagai shared (limit ketat)
     */
    setAsSharedDevice(deviceId: string): void {
        this.deviceConfigs.set(deviceId, { ...DEFAULT_CONFIG });
        logger.info(`[RateLimiter] Device ${deviceId} set as shared device`);
    }

    /**
     * Get atau create stats untuk device
     */
    private getDeviceStats(deviceId: string): DeviceStats {
        const now = Date.now();
        let stats = this.deviceStats.get(deviceId);

        if (!stats) {
            stats = {
                minuteCount: 0,
                hourCount: 0,
                minuteResetAt: now + 60000,
                hourResetAt: now + 3600000,
                lastSentAt: 0,
                queueLength: 0,
            };
            this.deviceStats.set(deviceId, stats);
        }

        // Reset counter jika sudah lewat periode
        if (now >= stats.minuteResetAt) {
            stats.minuteCount = 0;
            stats.minuteResetAt = now + 60000;
        }
        if (now >= stats.hourResetAt) {
            stats.hourCount = 0;
            stats.hourResetAt = now + 3600000;
        }

        return stats;
    }

    /**
     * Get config untuk device
     */
    private getDeviceConfig(deviceId: string): RateLimitConfig {
        return this.deviceConfigs.get(deviceId) || DEFAULT_CONFIG;
    }

    /**
     * Hitung delay yang diperlukan
     */
    private calculateDelay(deviceId: string): { delayMs: number; reason: string } {
        const stats = this.getDeviceStats(deviceId);
        const config = this.getDeviceConfig(deviceId);
        const now = Date.now();

        // 1. Check minimum delay antar pesan
        const timeSinceLastSend = now - stats.lastSentAt;
        if (timeSinceLastSend < config.minDelayMs) {
            return {
                delayMs: config.minDelayMs - timeSinceLastSend,
                reason: 'min_delay'
            };
        }

        // 2. Check rate limit per menit
        if (stats.minuteCount >= config.maxPerMinute) {
            const waitUntilMinuteReset = stats.minuteResetAt - now;
            return {
                delayMs: Math.max(waitUntilMinuteReset, 0),
                reason: 'minute_limit'
            };
        }

        // 3. Check rate limit per jam
        if (stats.hourCount >= config.maxPerHour) {
            const waitUntilHourReset = stats.hourResetAt - now;
            return {
                delayMs: Math.max(waitUntilHourReset, 0),
                reason: 'hour_limit'
            };
        }

        return { delayMs: 0, reason: 'none' };
    }

    /**
     * Execute dengan rate limiting
     * Akan auto-delay jika diperlukan
     */
    async execute<T>(
        deviceId: string,
        fn: () => Promise<T>,
        taskId?: string
    ): Promise<{ result: T; rateLimitInfo: RateLimitResult }> {
        if (this.isShuttingDown) {
            throw new Error('Server sedang restart, silakan coba lagi');
        }

        const id = taskId || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const stats = this.getDeviceStats(deviceId);
        const config = this.getDeviceConfig(deviceId);
        
        // Hitung delay dan posisi queue
        const { delayMs, reason } = this.calculateDelay(deviceId);
        const queue = this.deviceQueues.get(deviceId) || [];
        const queuePosition = queue.length + 1;
        
        // Estimasi waktu kirim (delay + queue wait)
        const estimatedDelayMs = delayMs + (queue.length * config.minDelayMs);
        const estimatedSendTime = new Date(Date.now() + estimatedDelayMs);

        const rateLimitInfo: RateLimitResult = {
            allowed: true,
            delayed: delayMs > 0 || queue.length > 0,
            delayMs: estimatedDelayMs,
            estimatedSendTime,
            queuePosition,
            message: this.generateMessage(delayMs, queue.length, reason)
        };

        // Log jika ada delay signifikan
        if (estimatedDelayMs > 5000) {
            logger.info(`[RateLimiter] Device ${deviceId}: Task ${id} delayed ${Math.round(estimatedDelayMs/1000)}s (${reason}), queue: ${queue.length}`);
        }

        // Tambah ke queue dan proses
        return new Promise((resolve, reject) => {
            const item: QueueItem = {
                id,
                deviceId,
                execute: async () => {
                    try {
                        // Wait for delay if needed
                        const currentDelay = this.calculateDelay(deviceId);
                        if (currentDelay.delayMs > 0) {
                            await this.sleep(currentDelay.delayMs);
                        }

                        // Execute function
                        const result = await fn();

                        // Update stats
                        const stats = this.getDeviceStats(deviceId);
                        stats.minuteCount++;
                        stats.hourCount++;
                        stats.lastSentAt = Date.now();
                        this.totalProcessed++;

                        resolve({ result, rateLimitInfo });
                    } catch (error) {
                        reject(error);
                    }
                },
                resolve: () => {},
                reject,
                addedAt: Date.now()
            };

            // Add to queue
            if (!this.deviceQueues.has(deviceId)) {
                this.deviceQueues.set(deviceId, []);
            }
            this.deviceQueues.get(deviceId)!.push(item);
            stats.queueLength = this.deviceQueues.get(deviceId)!.length;

            if (rateLimitInfo.delayed) {
                this.totalDelayed++;
            }

            // Start processing queue
            this.processQueue(deviceId);
        });
    }

    /**
     * Process queue untuk device tertentu
     */
    private async processQueue(deviceId: string): Promise<void> {
        // Prevent concurrent processing for same device
        if (this.processingDevices.has(deviceId)) {
            return;
        }

        const queue = this.deviceQueues.get(deviceId);
        if (!queue || queue.length === 0) {
            return;
        }

        this.processingDevices.add(deviceId);

        try {
            while (queue.length > 0 && !this.isShuttingDown) {
                const item = queue.shift();
                if (!item) break;

                // Update queue length
                const stats = this.getDeviceStats(deviceId);
                stats.queueLength = queue.length;

                await item.execute();
            }
        } finally {
            this.processingDevices.delete(deviceId);
        }
    }

    /**
     * Generate user-friendly message
     */
    private generateMessage(delayMs: number, queueLength: number, reason: string): string {
        if (delayMs === 0 && queueLength === 0) {
            return 'Pesan akan segera dikirim';
        }

        const totalDelaySeconds = Math.ceil(delayMs / 1000);
        
        if (queueLength > 0) {
            return `Pesan dalam antrian (posisi ${queueLength + 1}), estimasi terkirim dalam ${totalDelaySeconds} detik`;
        }

        switch (reason) {
            case 'minute_limit':
                return `Rate limit tercapai, pesan akan dikirim dalam ${totalDelaySeconds} detik`;
            case 'hour_limit':
                return `Limit per jam tercapai, pesan akan dikirim dalam ${Math.ceil(totalDelaySeconds / 60)} menit`;
            case 'min_delay':
                return `Pesan akan dikirim dalam ${totalDelaySeconds} detik`;
            default:
                return `Estimasi terkirim dalam ${totalDelaySeconds} detik`;
        }
    }

    /**
     * Get stats untuk device
     */
    getStats(deviceId: string): DeviceStats & { config: RateLimitConfig } {
        const stats = this.getDeviceStats(deviceId);
        const config = this.getDeviceConfig(deviceId);
        return { ...stats, config };
    }

    /**
     * Get global stats
     */
    getGlobalStats() {
        return {
            totalDevices: this.deviceStats.size,
            totalProcessed: this.totalProcessed,
            totalDelayed: this.totalDelayed,
            totalRejected: this.totalRejected,
            activeQueues: Array.from(this.deviceQueues.entries())
                .filter(([_, q]) => q.length > 0)
                .map(([deviceId, q]) => ({ deviceId, queueLength: q.length }))
        };
    }

    /**
     * Cleanup old stats untuk device yang tidak aktif
     */
    private cleanupOldStats(): void {
        const now = Date.now();
        const maxAge = 2 * 60 * 60 * 1000; // 2 jam

        for (const [deviceId, stats] of this.deviceStats.entries()) {
            if (now - stats.lastSentAt > maxAge && stats.queueLength === 0) {
                this.deviceStats.delete(deviceId);
                this.deviceConfigs.delete(deviceId);
            }
        }
    }

    /**
     * Graceful shutdown
     */
    async shutdown(): Promise<void> {
        this.isShuttingDown = true;
        logger.info('[RateLimiter] Shutting down...');

        // Reject semua queue
        for (const [deviceId, queue] of this.deviceQueues.entries()) {
            for (const item of queue) {
                item.reject(new Error('Server sedang restart'));
            }
            queue.length = 0;
        }

        logger.info(`[RateLimiter] Shutdown complete (processed: ${this.totalProcessed}, delayed: ${this.totalDelayed})`);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Global instance
const rateLimiter = new DeviceRateLimiter();

// Export functions
export const executeWithRateLimit = <T>(
    deviceId: string,
    fn: () => Promise<T>,
    taskId?: string
) => rateLimiter.execute(deviceId, fn, taskId);

export const setDeviceAsPersonal = (deviceId: string) => rateLimiter.setAsPersonalDevice(deviceId);
export const setDeviceAsShared = (deviceId: string) => rateLimiter.setAsSharedDevice(deviceId);
export const setDeviceRateLimitConfig = (deviceId: string, config: Partial<RateLimitConfig>) => rateLimiter.setDeviceConfig(deviceId, config);
export const getDeviceRateLimitStats = (deviceId: string) => rateLimiter.getStats(deviceId);
export const getRateLimiterGlobalStats = () => rateLimiter.getGlobalStats();
export const shutdownRateLimiter = () => rateLimiter.shutdown();

export default rateLimiter;

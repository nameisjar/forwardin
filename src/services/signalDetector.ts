/**
 * WhatsApp Signal Detector Service
 * 
 * Detects and logs signals from WhatsApp that indicate potential ban risks:
 * - Rate limits (429 errors)
 * - Forced logouts (401 errors)
 * - Connection errors
 * - Delivery failures
 * 
 * Features:
 * - Confidence scoring (high/medium/low) for signal classification accuracy
 * - Enhanced error message parsing for better detection
 * - Auto-pause functionality to prevent bans
 */

import prisma from '../utils/db';
import logger from '../config/logger';

// ============================================
// Types
// ============================================

export type SignalType = 
    | 'rate_limit'
    | 'forced_logout'
    | 'connection_error'
    | 'delivery_failed'
    | 'banned'
    | 'reconnected'
    | 'resumed';

export type SignalSeverity = 'info' | 'warning' | 'critical';

export type SignalConfidence = 'high' | 'medium' | 'low';

export type HealthStatus = 'healthy' | 'warning' | 'critical' | 'paused' | 'banned';

export type SignalAction = 'auto_paused' | 'manual_paused' | 'resumed' | 'none';

export interface SignalData {
    deviceId: number;
    deviceUuid: string;
    signalType: SignalType;
    code?: number;
    message?: string;
    severity?: SignalSeverity;
    confidence?: SignalConfidence;
    metadata?: Record<string, any>;
}

export interface DeviceHealthInfo {
    deviceId: string;
    phone: string | null;
    name: string;
    healthStatus: HealthStatus;
    pausedAt: Date | null;
    pauseReason: string | null;
    resumeAt: Date | null;
    todayMessageCount: number;
    recentSignals: Array<{
        signalType: string;
        code: number | null;
        message: string | null;
        severity: string;
        confidence: string;
        createdAt: Date;
    }>;
    stats: {
        rateLimitCount24h: number;
        errorCount24h: number;
        lastConnected: Date | null;
    };
    recommendation: string | null;
}

// ============================================
// Signal Classification Result
// ============================================

interface SignalClassification {
    signalType: SignalType;
    severity: SignalSeverity;
    confidence: SignalConfidence;
    reason: string;
}

// ============================================
// Error Message Patterns for Detection
// ============================================

const LOGOUT_PATTERNS = [
    /logged\s*out/i,
    /logout/i,
    /session\s*expired/i,
    /unauthorized/i,
    /forbidden/i,
    /invalid\s*session/i,
];

const BAN_PATTERNS = [
    /banned/i,
    /suspended/i,
    /account\s*blocked/i,
    /permanently\s*blocked/i,
    /violat(ed?|ing)\s*(terms|policy)/i,
    /restricted/i,
];

const RATE_LIMIT_PATTERNS = [
    /rate[\s-]*limit/i,
    /too\s*many\s*requests/i,
    /rate[\s-]*overlimit/i,
    /slow\s*down/i,
    /try\s*again\s*later/i,
    /429/,
];

const TEMPORARY_ERROR_PATTERNS = [
    /timeout/i,
    /econnreset/i,
    /econnrefused/i,
    /etimedout/i,
    /socket\s*hang\s*up/i,
    /network/i,
    /temporary/i,
    /unavailable/i,
    /restart\s*required/i,
    /stream\s*errored/i,    // Normal saat reconnect conflict
    /conflict/i,            // Session conflict saat reconnect
    /connection\s*closed/i, // Generic connection closed
];

// ============================================
// Enhanced Signal Classification
// ============================================

/**
 * Classify a disconnect reason based on code AND message for improved accuracy
 * Returns signal type, severity, and confidence level
 */
export function classifyDisconnectReason(code: number, message: string): SignalClassification {
    const msgLower = message.toLowerCase();

    // === PRIORITY: Check for temporary/conflict errors FIRST ===
    // These are normal during reconnection and should NOT be classified as forced_logout
    if (TEMPORARY_ERROR_PATTERNS.some(p => p.test(message))) {
        return {
            signalType: 'connection_error',
            severity: 'info',
            confidence: 'high',
            reason: `Temporary/conflict error: "${message.substring(0, 50)}" - Safe to reconnect`,
        };
    }

    // === HIGH CONFIDENCE: Direct logout codes with matching message ===
    if (code === 401) {
        const hasLogoutMessage = LOGOUT_PATTERNS.some(p => p.test(message));
        return {
            signalType: 'forced_logout',
            severity: 'critical',
            confidence: hasLogoutMessage ? 'high' : 'medium',
            reason: 'Code 401 (Unauthorized) - Session invalidated',
        };
    }

    // === HIGH CONFIDENCE: LoggedOut code from Baileys ===
    if (code === 403 || code === 405) {
        const hasLogoutMessage = LOGOUT_PATTERNS.some(p => p.test(message));
        return {
            signalType: 'forced_logout',
            severity: 'critical',
            confidence: hasLogoutMessage ? 'high' : 'high', // 403/405 are very reliable
            reason: `Code ${code} - Forced logout from WhatsApp`,
        };
    }

    // === MEDIUM CONFIDENCE: Session replaced ===
    if (code === 428 || code === 440) {
        return {
            signalType: 'forced_logout',
            severity: 'critical',
            confidence: 'high',
            reason: `Code ${code} - Session replaced (login from another device)`,
        };
    }

    // === Check message for BAN indicators (override code-based detection) ===
    if (BAN_PATTERNS.some(p => p.test(message))) {
        return {
            signalType: 'banned',
            severity: 'critical',
            confidence: 'high', // Message explicitly says banned
            reason: `Ban detected from message: "${message.substring(0, 100)}"`,
        };
    }

    // === LOW/MEDIUM CONFIDENCE: Codes that MIGHT indicate ban ===
    if (code === 500) {
        // 500 = Internal error - could be server issue OR ban
        const hasBanIndicator = BAN_PATTERNS.some(p => p.test(message));
        const hasLogoutIndicator = LOGOUT_PATTERNS.some(p => p.test(message));
        
        if (hasBanIndicator) {
            return {
                signalType: 'banned',
                severity: 'critical',
                confidence: 'medium',
                reason: 'Code 500 with ban-related message',
            };
        }
        if (hasLogoutIndicator) {
            return {
                signalType: 'forced_logout',
                severity: 'critical',
                confidence: 'medium',
                reason: 'Code 500 with logout-related message',
            };
        }
        return {
            signalType: 'connection_error',
            severity: 'warning',
            confidence: 'low',
            reason: 'Code 500 (Internal Error) - Could be server issue or ban',
        };
    }

    if (code === 411) {
        // 411 = multideviceMismatch - usually indicates session issues, not always ban
        const hasBanIndicator = BAN_PATTERNS.some(p => p.test(message));
        return {
            signalType: hasBanIndicator ? 'banned' : 'connection_error',
            severity: hasBanIndicator ? 'critical' : 'warning',
            confidence: hasBanIndicator ? 'medium' : 'low',
            reason: 'Code 411 (Multidevice Mismatch) - Session sync issue',
        };
    }

    // === HIGH CONFIDENCE: Temporary/Network errors ===
    if (code === 408 || code === 515 || code === 516) {
        return {
            signalType: 'connection_error',
            severity: 'info',
            confidence: 'high',
            reason: `Code ${code} - Temporary connection issue (safe to reconnect)`,
        };
    }

    // === Check message for rate limit indicators ===
    if (RATE_LIMIT_PATTERNS.some(p => p.test(message))) {
        return {
            signalType: 'rate_limit',
            severity: 'warning',
            confidence: 'high',
            reason: 'Rate limit detected from message pattern',
        };
    }

    // === Check for temporary errors from message ===
    if (TEMPORARY_ERROR_PATTERNS.some(p => p.test(message))) {
        return {
            signalType: 'connection_error',
            severity: 'info',
            confidence: 'high',
            reason: 'Temporary network/connection error',
        };
    }

    // === Default: Unknown code, treat as connection error with low confidence ===
    return {
        signalType: 'connection_error',
        severity: 'warning',
        confidence: 'low',
        reason: `Unknown code ${code}: "${message.substring(0, 100)}"`,
    };
}

/**
 * Classify a rate limit error with confidence scoring
 */
export function classifyRateLimitError(error: any): SignalClassification {
    const errorMessage = String(error?.message || error || '');
    const errorCode = error?.data || error?.output?.statusCode || 429;

    // Check for explicit 429 code
    if (errorCode === 429) {
        return {
            signalType: 'rate_limit',
            severity: 'warning',
            confidence: 'high',
            reason: 'HTTP 429 Rate Limit response',
        };
    }

    // Check message patterns
    if (RATE_LIMIT_PATTERNS.some(p => p.test(errorMessage))) {
        return {
            signalType: 'rate_limit',
            severity: 'warning',
            confidence: 'high',
            reason: `Rate limit pattern in message: "${errorMessage.substring(0, 50)}"`,
        };
    }

    // Fallback - we called this function so assume it's rate limit but low confidence
    return {
        signalType: 'rate_limit',
        severity: 'warning',
        confidence: 'medium',
        reason: 'Assumed rate limit from context',
    };
}

// ============================================
// Configuration
// ============================================

// Rate limit thresholds
const RATE_LIMIT_THRESHOLD = 3; // Number of rate limits before auto-pause
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour window

// Auto-pause durations
const PAUSE_DURATION_RATE_LIMIT = 30 * 60 * 1000; // 30 minutes
const PAUSE_DURATION_CRITICAL = 2 * 60 * 60 * 1000; // 2 hours

// In-memory tracking for rate limit counts (per device)
const rateLimitCounts: Map<number, { count: number; firstAt: Date }> = new Map();

// ============================================
// Signal Recording
// ============================================

/**
 * Record a signal from WhatsApp
 */
export async function recordSignal(data: SignalData): Promise<void> {
    const { 
        deviceId, 
        deviceUuid, 
        signalType, 
        code, 
        message, 
        severity = 'warning', 
        confidence = 'medium',
        metadata 
    } = data;

    try {
        // Determine action based on signal type
        let action: SignalAction = 'none';
        let shouldPause = false;
        let pauseDuration = 0;
        let pauseReason = '';

        if (signalType === 'rate_limit') {
            // Track rate limits in memory
            const tracking = rateLimitCounts.get(deviceId) || { count: 0, firstAt: new Date() };
            const now = new Date();
            
            // Reset if outside window
            if (now.getTime() - tracking.firstAt.getTime() > RATE_LIMIT_WINDOW_MS) {
                tracking.count = 1;
                tracking.firstAt = now;
            } else {
                tracking.count++;
            }
            rateLimitCounts.set(deviceId, tracking);

            // Check if threshold exceeded
            if (tracking.count >= RATE_LIMIT_THRESHOLD) {
                shouldPause = true;
                pauseDuration = PAUSE_DURATION_RATE_LIMIT;
                pauseReason = `Rate limit terdeteksi ${tracking.count}x dalam 1 jam`;
                action = 'auto_paused';
                
                // Reset counter after pause
                rateLimitCounts.delete(deviceId);
            }

            logger.warn(
                { deviceId: deviceUuid, count: tracking.count, threshold: RATE_LIMIT_THRESHOLD, confidence },
                `[SignalDetector] Rate limit detected (${tracking.count}/${RATE_LIMIT_THRESHOLD}) [${confidence}]`
            );
        }

        if (signalType === 'forced_logout' || signalType === 'banned') {
            // Only auto-pause on high/medium confidence
            if (confidence !== 'low') {
                shouldPause = true;
                pauseDuration = 0; // Indefinite until manual resume
                pauseReason = signalType === 'banned' 
                    ? `Device terdeteksi banned oleh WhatsApp (${confidence} confidence)`
                    : `WhatsApp memaksa logout (${confidence} confidence)`;
                action = 'auto_paused';
            }

            logger.error(
                { deviceId: deviceUuid, code, message, confidence },
                `[SignalDetector] ${signalType === 'banned' ? 'BANNED' : 'FORCED LOGOUT'} detected! [${confidence}]`
            );
        }

        // Save signal to database
        await prisma.deviceSignal.create({
            data: {
                deviceId,
                signalType,
                code,
                message,
                severity: signalType === 'banned' || signalType === 'forced_logout' ? 'critical' : severity,
                confidence,
                action,
                metadata: metadata || {},
            },
        });

        // Auto-pause if needed
        if (shouldPause) {
            await pauseDevice(deviceId, pauseReason, pauseDuration);
        }

        // Update device health status based on recent signals
        await updateDeviceHealthStatus(deviceId);

    } catch (error) {
        logger.error({ error, deviceId: deviceUuid }, '[SignalDetector] Failed to record signal');
    }
}

/**
 * Record a rate limit error (convenience function)
 * @param devicePkId - Device primary key (pkId in DB)
 * @param code - Rate limit code (default 429)
 */
export async function recordRateLimit(devicePkId: number, code = 429): Promise<void> {
    // Fetch device UUID from pkId
    const device = await prisma.device.findUnique({
        where: { pkId: devicePkId },
        select: { id: true },
    });
    
    if (!device) {
        logger.warn({ devicePkId }, 'recordRateLimit: Device not found');
        return;
    }

    const deviceUuid = device.id;

    // Use enhanced classification for better accuracy
    const classification = classifyRateLimitError({ data: code, message: 'WhatsApp rate limit exceeded' });

    await recordSignal({
        deviceId: devicePkId,
        deviceUuid,
        signalType: classification.signalType,
        code,
        message: `WhatsApp rate limit exceeded (${classification.reason})`,
        severity: classification.severity,
        confidence: classification.confidence,
        metadata: { classificationReason: classification.reason },
    });
}

/**
 * Record a rate limit error with full error object for better classification
 * @param devicePkId - Device primary key (pkId in DB)
 * @param error - The error object from WhatsApp/Baileys
 */
export async function recordRateLimitWithError(devicePkId: number, error: any): Promise<void> {
    // Fetch device UUID from pkId
    const device = await prisma.device.findUnique({
        where: { pkId: devicePkId },
        select: { id: true },
    });
    
    if (!device) {
        logger.warn({ devicePkId }, 'recordRateLimitWithError: Device not found');
        return;
    }

    const deviceUuid = device.id;
    const classification = classifyRateLimitError(error);
    const errorCode = error?.data || error?.output?.statusCode || 429;
    const errorMessage = String(error?.message || error || 'Rate limit detected');

    await recordSignal({
        deviceId: devicePkId,
        deviceUuid,
        signalType: classification.signalType,
        code: errorCode,
        message: errorMessage,
        severity: classification.severity,
        confidence: classification.confidence,
        metadata: { 
            classificationReason: classification.reason,
            originalError: errorMessage,
        },
    });
}

/**
 * Record a connection error with enhanced classification
 * @param devicePkId - Device primary key (pkId in DB)
 * @param code - Disconnect/error code
 * @param reason - Error message/reason
 */
export async function recordConnectionError(
    devicePkId: number, 
    code: number, 
    reason: string
): Promise<void> {
    // Fetch device UUID from pkId
    const device = await prisma.device.findUnique({
        where: { pkId: devicePkId },
        select: { id: true },
    });
    
    if (!device) {
        logger.warn({ devicePkId }, 'recordConnectionError: Device not found');
        return;
    }

    const deviceUuid = device.id;

    // Use enhanced classification for better accuracy
    const classification = classifyDisconnectReason(code, reason);

    logger.info(
        { devicePkId, code, reason, classification },
        `[SignalDetector] Connection error classified: ${classification.signalType} (${classification.confidence})`
    );

    await recordSignal({
        deviceId: devicePkId,
        deviceUuid,
        signalType: classification.signalType,
        code,
        message: reason,
        severity: classification.severity,
        confidence: classification.confidence,
        metadata: { 
            disconnectCode: code,
            classificationReason: classification.reason,
        },
    });
}

/**
 * Record successful reconnection (clears some warning states)
 * Also auto-resumes device if it was paused due to forced_logout
 * @param devicePkId - Device primary key (pkId in DB)
 */
export async function recordReconnection(devicePkId: number): Promise<void> {
    // Fetch device with current health status
    const device = await prisma.device.findUnique({
        where: { pkId: devicePkId },
        select: { 
            id: true, 
            healthStatus: true,
            pauseReason: true,
        },
    });
    
    if (!device) {
        logger.warn({ devicePkId }, 'recordReconnection: Device not found');
        return;
    }

    const deviceUuid = device.id;

    // 🔥 Auto-resume if device was paused (user successfully reconnected = not banned)
    if (device.healthStatus === 'paused') {
        logger.info(
            { devicePkId, previousStatus: device.healthStatus, pauseReason: device.pauseReason },
            '🔄 Device reconnected successfully - auto-resuming from paused state'
        );
        
        await prisma.device.update({
            where: { pkId: devicePkId },
            data: {
                healthStatus: 'healthy',
                pausedAt: null,
                pauseReason: null,
                resumeAt: null,
                updatedAt: new Date(),
            },
        });
    }

    await recordSignal({
        deviceId: devicePkId,
        deviceUuid,
        signalType: 'reconnected',
        severity: 'info',
        confidence: 'high',
        message: device.healthStatus === 'paused' 
            ? 'Device reconnected and auto-resumed from paused state'
            : 'Device reconnected successfully',
    });
}

// ============================================
// Device Pause/Resume
// ============================================

/**
 * Pause a device (auto or manual)
 */
export async function pauseDevice(
    devicePkId: number, 
    reason: string, 
    durationMs: number = 0
): Promise<void> {
    const now = new Date();
    const resumeAt = durationMs > 0 ? new Date(now.getTime() + durationMs) : null;

    await prisma.device.update({
        where: { pkId: devicePkId },
        data: {
            healthStatus: 'paused',
            pausedAt: now,
            pauseReason: reason,
            resumeAt,
            updatedAt: now,
        },
    });

    logger.warn(
        { devicePkId, reason, resumeAt },
        '[SignalDetector] Device paused'
    );
}

/**
 * Resume a paused device
 */
export async function resumeDevice(devicePkId: number): Promise<void> {
    // Clear pause state
    await prisma.device.update({
        where: { pkId: devicePkId },
        data: {
            healthStatus: 'healthy',
            pausedAt: null,
            pauseReason: null,
            resumeAt: null,
            updatedAt: new Date(),
        },
    });

    // Record resume signal
    const device = await prisma.device.findUnique({
        where: { pkId: devicePkId },
        select: { id: true },
    });

    if (device) {
        await recordSignal({
            deviceId: devicePkId,
            deviceUuid: device.id,
            signalType: 'resumed',
            severity: 'info',
            message: 'Device resumed',
        });
    }

    // Clear rate limit tracking
    rateLimitCounts.delete(devicePkId);

    logger.info({ devicePkId }, '[SignalDetector] Device resumed');
}

/**
 * Check and auto-resume devices whose pause duration has expired
 */
export async function checkAutoResume(): Promise<void> {
    const now = new Date();

    // Limit to 100 devices per batch to prevent memory issues with large datasets
    const devicesToResume = await prisma.device.findMany({
        where: {
            healthStatus: 'paused',
            resumeAt: { lte: now },
        },
        select: { pkId: true, id: true },
        take: 100,
    });

    for (const device of devicesToResume) {
        await resumeDevice(device.pkId);
        logger.info({ deviceId: device.id }, '[SignalDetector] Device auto-resumed after cooldown');
    }
}

// ============================================
// Health Status
// ============================================

/**
 * Update device health status based on recent signals
 * Now considers reconnection as clearing previous issues
 */
async function updateDeviceHealthStatus(devicePkId: number): Promise<void> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get recent signals
    const recentSignals = await prisma.deviceSignal.findMany({
        where: {
            deviceId: devicePkId,
            createdAt: { gte: oneDayAgo },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
    });

    // 🔥 Check if most recent signal is a successful reconnection
    // If so, device is healthy regardless of past errors
    const mostRecent = recentSignals[0];
    if (mostRecent?.signalType === 'reconnected') {
        // Reconnection clears previous issues
        const currentDevice = await prisma.device.findUnique({
            where: { pkId: devicePkId },
            select: { healthStatus: true },
        });

        // Only update if not already healthy
        if (currentDevice?.healthStatus !== 'healthy') {
            await prisma.device.update({
                where: { pkId: devicePkId },
                data: { healthStatus: 'healthy' },
            });
        }
        return;
    }

    // Count critical and warning signals (only those AFTER last reconnection)
    const lastReconnectIndex = recentSignals.findIndex(s => s.signalType === 'reconnected');
    const signalsAfterReconnect = lastReconnectIndex === -1 
        ? recentSignals 
        : recentSignals.slice(0, lastReconnectIndex);

    const criticalCount = signalsAfterReconnect.filter(s => s.severity === 'critical').length;
    const warningCount = signalsAfterReconnect.filter(s => s.severity === 'warning').length;
    const rateLimitCount = signalsAfterReconnect.filter(s => s.signalType === 'rate_limit').length;

    // Determine health status
    let newStatus: HealthStatus = 'healthy';

    if (signalsAfterReconnect.some(s => s.signalType === 'banned')) {
        newStatus = 'banned';
    } else if (criticalCount > 0 || rateLimitCount >= RATE_LIMIT_THRESHOLD) {
        newStatus = 'critical';
    } else if (warningCount >= 2 || rateLimitCount >= 2) {
        newStatus = 'warning';
    }

    // Don't override paused/banned status
    const currentDevice = await prisma.device.findUnique({
        where: { pkId: devicePkId },
        select: { healthStatus: true },
    });

    if (currentDevice?.healthStatus === 'paused' || currentDevice?.healthStatus === 'banned') {
        return;
    }

    // Update status
    await prisma.device.update({
        where: { pkId: devicePkId },
        data: { healthStatus: newStatus },
    });
}

/**
 * Get device health information
 */
export async function getDeviceHealth(deviceUuid: string): Promise<DeviceHealthInfo | null> {
    const device = await prisma.device.findUnique({
        where: { id: deviceUuid },
        select: {
            id: true,
            name: true,
            phone: true,
            healthStatus: true,
            pausedAt: true,
            pauseReason: true,
            resumeAt: true,
            todayMessageCount: true,
            deviceSignals: {
                orderBy: { createdAt: 'desc' },
                take: 10,
                select: {
                    signalType: true,
                    code: true,
                    message: true,
                    severity: true,
                    confidence: true,
                    createdAt: true,
                },
            },
        },
    });

    if (!device) return null;

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get 24h stats
    const [rateLimitCount24h, errorCount24h] = await Promise.all([
        prisma.deviceSignal.count({
            where: {
                device: { id: deviceUuid },
                signalType: 'rate_limit',
                createdAt: { gte: oneDayAgo },
            },
        }),
        prisma.deviceSignal.count({
            where: {
                device: { id: deviceUuid },
                severity: { in: ['warning', 'critical'] },
                createdAt: { gte: oneDayAgo },
            },
        }),
    ]);

    // Get last connected time
    const lastReconnect = await prisma.deviceSignal.findFirst({
        where: {
            device: { id: deviceUuid },
            signalType: 'reconnected',
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
    });

    // Generate recommendation
    let recommendation: string | null = null;
    if (device.healthStatus === 'banned') {
        recommendation = 'Device terdeteksi banned. Gunakan nomor lain atau tunggu beberapa hari.';
    } else if (device.healthStatus === 'paused') {
        recommendation = device.resumeAt 
            ? `Device di-pause. Akan resume otomatis pada ${device.resumeAt.toLocaleString()}`
            : 'Device di-pause. Resume manual diperlukan.';
    } else if (device.healthStatus === 'critical') {
        recommendation = 'Kurangi volume pengiriman segera. Istirahatkan device 1-2 jam.';
    } else if (device.healthStatus === 'warning') {
        recommendation = 'Perhatikan volume pengiriman. Tambah delay antar pesan.';
    }

    return {
        deviceId: device.id,
        phone: device.phone,
        name: device.name,
        healthStatus: device.healthStatus as HealthStatus,
        pausedAt: device.pausedAt,
        pauseReason: device.pauseReason,
        resumeAt: device.resumeAt,
        todayMessageCount: device.todayMessageCount,
        recentSignals: device.deviceSignals,
        stats: {
            rateLimitCount24h,
            errorCount24h,
            lastConnected: lastReconnect?.createdAt || null,
        },
        recommendation,
    };
}

/**
 * Check if a device is allowed to send messages
 */
export async function canDeviceSend(devicePkId: number): Promise<{ allowed: boolean; reason?: string }> {
    const device = await prisma.device.findUnique({
        where: { pkId: devicePkId },
        select: { 
            healthStatus: true, 
            pausedAt: true, 
            pauseReason: true,
            resumeAt: true,
        },
    });

    if (!device) {
        return { allowed: false, reason: 'Device not found' };
    }

    if (device.healthStatus === 'banned') {
        return { allowed: false, reason: 'Device terdeteksi banned oleh WhatsApp' };
    }

    if (device.healthStatus === 'paused') {
        // Check if should auto-resume
        if (device.resumeAt && device.resumeAt <= new Date()) {
            await resumeDevice(devicePkId);
            return { allowed: true };
        }

        const resumeInfo = device.resumeAt 
            ? `Resume pada ${device.resumeAt.toLocaleString()}`
            : 'Resume manual diperlukan';
        return { 
            allowed: false, 
            reason: `Device di-pause: ${device.pauseReason}. ${resumeInfo}` 
        };
    }

    return { allowed: true };
}

/**
 * Increment today's message count for a device
 */
export async function incrementMessageCount(devicePkId: number): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const device = await prisma.device.findUnique({
        where: { pkId: devicePkId },
        select: { todayMessageDate: true, todayMessageCount: true },
    });

    if (!device) return;

    const deviceDate = device.todayMessageDate ? new Date(device.todayMessageDate) : null;
    const isSameDay = deviceDate && deviceDate.getTime() === today.getTime();

    await prisma.device.update({
        where: { pkId: devicePkId },
        data: {
            todayMessageCount: isSameDay ? { increment: 1 } : 1,
            todayMessageDate: today,
        },
    });
}

// ============================================
// Cleanup
// ============================================

/**
 * Clean up old signals (keep last 30 days)
 */
export async function cleanupOldSignals(): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await prisma.deviceSignal.deleteMany({
        where: { createdAt: { lt: thirtyDaysAgo } },
    });

    if (result.count > 0) {
        logger.info({ deletedCount: result.count }, '[SignalDetector] Cleaned up old signals');
    }

    return result.count;
}

// Export default for convenience
export default {
    recordSignal,
    recordRateLimit,
    recordConnectionError,
    recordReconnection,
    pauseDevice,
    resumeDevice,
    checkAutoResume,
    getDeviceHealth,
    canDeviceSend,
    incrementMessageCount,
    cleanupOldSignals,
};

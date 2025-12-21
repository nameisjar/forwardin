/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ============================================
 * 🎲 NATURAL DELAY SERVICE
 * ============================================
 * 
 * Service untuk membuat pola pengiriman pesan lebih natural
 * seperti manusia, bukan robotik dengan delay konstan.
 * 
 * Fitur:
 * - Random Jitter: Variasi delay ±40-60%
 * - Cluster Pattern: Grup pesan dengan jeda panjang
 * - Progressive Slowdown: Delay bertambah seiring jumlah pesan
 * - Typing Simulation: Delay berdasarkan panjang pesan
 * - Typing Indicator: Tampilkan "sedang mengetik..." (opsional)
 * 
 * Konfigurasi via Environment Variable
 * ============================================
 */

import logger from '../config/logger';
import { redactPhone } from '../utils/logRedaction';

// ============================================
// CONFIGURATION (from Environment Variables)
// ============================================

export interface NaturalDelayConfig {
    // Base delay
    baseDelay: number;
    
    // Jitter
    jitterMin: number;
    jitterMax: number;
    
    // Cluster
    clusterEnabled: boolean;
    clusterSizeMin: number;
    clusterSizeMax: number;
    clusterPauseMin: number;
    clusterPauseMax: number;
    
    // Progressive
    progressiveEnabled: boolean;
    progressiveThreshold: number;
    progressiveIncrement: number;
    
    // Typing simulation
    typingEnabled: boolean;
    typingSpeed: number;
    typingMaxDelay: number;
    typingJitterMin: number;
    typingJitterMax: number;
    
    // Typing indicator (show "typing..." in WhatsApp)
    typingIndicatorEnabled: boolean;
}

/**
 * Load konfigurasi dari environment variables
 */
export function loadNaturalDelayConfig(): NaturalDelayConfig {
    return {
        // Base delay
        baseDelay: Number(process.env.BROADCAST_BASE_DELAY) || 5000,
        
        // Jitter range
        jitterMin: Number(process.env.DELAY_JITTER_MIN) || -0.4,
        jitterMax: Number(process.env.DELAY_JITTER_MAX) || 0.6,
        
        // Cluster pattern
        clusterEnabled: process.env.CLUSTER_ENABLED !== 'false',
        clusterSizeMin: Number(process.env.CLUSTER_SIZE_MIN) || 3,
        clusterSizeMax: Number(process.env.CLUSTER_SIZE_MAX) || 7,
        clusterPauseMin: Number(process.env.CLUSTER_PAUSE_MIN) || 10000,
        clusterPauseMax: Number(process.env.CLUSTER_PAUSE_MAX) || 20000,
        
        // Progressive slowdown
        progressiveEnabled: process.env.PROGRESSIVE_ENABLED !== 'false',
        progressiveThreshold: Number(process.env.PROGRESSIVE_THRESHOLD) || 20,
        progressiveIncrement: Number(process.env.PROGRESSIVE_INCREMENT) || 0.05,
        
        // Typing simulation
        typingEnabled: process.env.TYPING_ENABLED !== 'false',
        typingSpeed: Number(process.env.TYPING_SPEED) || 3,
        typingMaxDelay: Number(process.env.TYPING_MAX_DELAY) || 10000,
        typingJitterMin: Number(process.env.TYPING_JITTER_MIN) || 0.5,
        typingJitterMax: Number(process.env.TYPING_JITTER_MAX) || 1.5,
        
        // Typing indicator
        typingIndicatorEnabled: process.env.TYPING_INDICATOR_ENABLED === 'true',
    };
}

// ============================================
// CLUSTER STATE TRACKER
// ============================================

interface ClusterState {
    currentClusterSize: number;
    messagesInCurrentCluster: number;
    totalMessagesSent: number;
}

// State per device untuk tracking cluster
const deviceClusterStates = new Map<string, ClusterState>();

/**
 * Get atau create cluster state untuk device
 */
function getClusterState(deviceId: string): ClusterState {
    if (!deviceClusterStates.has(deviceId)) {
        deviceClusterStates.set(deviceId, {
            currentClusterSize: 0,
            messagesInCurrentCluster: 0,
            totalMessagesSent: 0,
        });
    }
    return deviceClusterStates.get(deviceId)!;
}

/**
 * Reset cluster state untuk device (dipanggil saat broadcast baru dimulai)
 */
export function resetClusterState(deviceId: string): void {
    deviceClusterStates.set(deviceId, {
        currentClusterSize: 0,
        messagesInCurrentCluster: 0,
        totalMessagesSent: 0,
    });
    logger.debug({ deviceId }, '[NaturalDelay] Cluster state reset');
}

/**
 * Reset semua cluster states
 */
export function resetAllClusterStates(): void {
    deviceClusterStates.clear();
    logger.debug('[NaturalDelay] All cluster states reset');
}

// ============================================
// DELAY CALCULATION FUNCTIONS
// ============================================

/**
 * Generate random number dalam range
 */
function randomInRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

/**
 * Hitung jitter delay
 * Menambahkan variasi acak ke base delay
 */
function calculateJitterDelay(baseDelay: number, config: NaturalDelayConfig): number {
    const multiplier = 1 + randomInRange(config.jitterMin, config.jitterMax);
    return Math.floor(baseDelay * multiplier);
}

/**
 * Hitung cluster pause
 * Return delay panjang jika di akhir cluster, 0 jika tidak
 */
function calculateClusterPause(deviceId: string, config: NaturalDelayConfig): number {
    if (!config.clusterEnabled) return 0;
    
    const state = getClusterState(deviceId);
    
    // Generate cluster size baru jika belum ada
    if (state.currentClusterSize === 0) {
        state.currentClusterSize = Math.floor(
            randomInRange(config.clusterSizeMin, config.clusterSizeMax + 1)
        );
        state.messagesInCurrentCluster = 0;
        logger.debug(
            { deviceId, clusterSize: state.currentClusterSize },
            '[NaturalDelay] New cluster started'
        );
    }
    
    state.messagesInCurrentCluster++;
    state.totalMessagesSent++;
    
    // Cek apakah sudah akhir cluster
    if (state.messagesInCurrentCluster >= state.currentClusterSize) {
        // Reset untuk cluster berikutnya
        state.currentClusterSize = 0;
        state.messagesInCurrentCluster = 0;
        
        // Return pause panjang
        const pause = Math.floor(randomInRange(config.clusterPauseMin, config.clusterPauseMax));
        logger.debug(
            { deviceId, pause, totalSent: state.totalMessagesSent },
            '[NaturalDelay] Cluster ended, adding pause'
        );
        return pause;
    }
    
    return 0;
}

/**
 * Hitung progressive slowdown
 * Delay bertambah seiring jumlah pesan yang sudah dikirim
 */
function calculateProgressiveDelay(deviceId: string, baseDelay: number, config: NaturalDelayConfig): number {
    if (!config.progressiveEnabled) return 0;
    
    const state = getClusterState(deviceId);
    const messagesSent = state.totalMessagesSent;
    
    if (messagesSent < config.progressiveThreshold) return 0;
    
    // Hitung berapa "batch" di atas threshold
    const batchesAboveThreshold = Math.floor((messagesSent - config.progressiveThreshold) / 10);
    const slowdownMultiplier = batchesAboveThreshold * config.progressiveIncrement;
    
    const additionalDelay = Math.floor(baseDelay * slowdownMultiplier);
    
    if (additionalDelay > 0) {
        logger.debug(
            { deviceId, messagesSent, slowdownMultiplier, additionalDelay },
            '[NaturalDelay] Progressive slowdown applied'
        );
    }
    
    return additionalDelay;
}

/**
 * Hitung typing simulation delay
 * Delay berdasarkan panjang pesan (seolah sedang mengetik)
 */
function calculateTypingDelay(messageLength: number, config: NaturalDelayConfig): number {
    if (!config.typingEnabled || messageLength === 0) return 0;
    
    // Base typing time = panjang / kecepatan ketik
    const baseTypingTime = (messageLength / config.typingSpeed) * 1000; // convert to ms
    
    // Tambah jitter
    const jitterMultiplier = randomInRange(config.typingJitterMin, config.typingJitterMax);
    let typingDelay = Math.floor(baseTypingTime * jitterMultiplier);
    
    // Cap ke max delay
    typingDelay = Math.min(typingDelay, config.typingMaxDelay);
    
    logger.debug(
        { messageLength, baseTypingTime, typingDelay, maxDelay: config.typingMaxDelay },
        '[NaturalDelay] Typing delay calculated'
    );
    
    return typingDelay;
}

// ============================================
// MAIN FUNCTIONS
// ============================================

export interface NaturalDelayResult {
    totalDelay: number;
    breakdown: {
        baseDelay: number;
        jitterDelay: number;
        clusterPause: number;
        progressiveDelay: number;
        typingDelay: number;
    };
    isClusterEnd: boolean;
    shouldShowTypingIndicator: boolean;
    typingIndicatorDuration: number;
    showIndicatorInWhatsApp: boolean;
}

/**
 * Hitung total natural delay untuk pengiriman pesan
 * 
 * @param deviceId - ID device untuk tracking cluster state
 * @param baseDelay - Base delay dari broadcast config (atau default)
 * @param messageLength - Panjang pesan untuk typing simulation
 * @param config - Konfigurasi (opsional, akan load dari env jika tidak disediakan)
 */
export function calculateNaturalDelay(
    deviceId: string,
    baseDelay?: number,
    messageLength: number = 0,
    config?: NaturalDelayConfig
): NaturalDelayResult {
    const cfg = config || loadNaturalDelayConfig();
    const effectiveBaseDelay = baseDelay || cfg.baseDelay;
    
    // Hitung semua komponen delay
    const jitterDelay = calculateJitterDelay(effectiveBaseDelay, cfg);
    const clusterPause = calculateClusterPause(deviceId, cfg);
    const progressiveDelay = calculateProgressiveDelay(deviceId, effectiveBaseDelay, cfg);
    const typingDelay = calculateTypingDelay(messageLength, cfg);
    
    // Total = jitter (sudah include base) + cluster + progressive + typing
    // Note: jitterDelay sudah mengandung baseDelay dengan variasi
    const totalDelay = jitterDelay + clusterPause + progressiveDelay + typingDelay;
    
    const result: NaturalDelayResult = {
        totalDelay,
        breakdown: {
            baseDelay: effectiveBaseDelay,
            jitterDelay: jitterDelay - effectiveBaseDelay, // pure jitter tanpa base
            clusterPause,
            progressiveDelay,
            typingDelay,
        },
        isClusterEnd: clusterPause > 0,
        // 🔥 FIX: shouldShowTypingIndicator = true jika ada typingDelay > 0
        // Ini memastikan delay typing SELALU dijalankan sebelum kirim pesan
        // TYPING_INDICATOR_ENABLED hanya mengontrol apakah tampilkan "sedang mengetik..." atau tidak
        shouldShowTypingIndicator: typingDelay > 0,
        typingIndicatorDuration: typingDelay,
        // 🔥 NEW: Flag untuk menentukan apakah tampilkan indicator atau hanya delay
        showIndicatorInWhatsApp: cfg.typingIndicatorEnabled,
    };
    
    logger.info(
        { 
            deviceId, 
            totalDelay: result.totalDelay,
            breakdown: result.breakdown,
            isClusterEnd: result.isClusterEnd,
            showIndicatorInWhatsApp: result.showIndicatorInWhatsApp,
        },
        '[NaturalDelay] Delay calculated'
    );
    
    return result;
}

/**
 * Sleep dengan natural delay
 * Utility function untuk langsung sleep dengan delay yang sudah dihitung
 */
export async function sleepWithNaturalDelay(
    deviceId: string,
    baseDelay?: number,
    messageLength: number = 0,
    config?: NaturalDelayConfig
): Promise<NaturalDelayResult> {
    const result = calculateNaturalDelay(deviceId, baseDelay, messageLength, config);
    
    if (result.totalDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, result.totalDelay));
    }
    
    return result;
}

/**
 * Tampilkan typing indicator atau hanya delay sebelum kirim pesan
 * 
 * @param session - WhatsApp session dari Baileys
 * @param jid - JID penerima
 * @param duration - Durasi delay/typing indicator (ms)
 * @param showIndicator - Jika true, tampilkan "sedang mengetik...". Jika false, hanya delay.
 */
export async function showTypingIndicator(
    session: any,
    jid: string,
    duration: number,
    showIndicator: boolean = true
): Promise<void> {
    if (duration <= 0) return;
    
    try {
        if (!showIndicator) {
            // 🔥 TYPING_INDICATOR_ENABLED=false: Hanya delay tanpa tampilkan "sedang mengetik..."
            logger.debug({ jid: redactPhone(jid), duration }, '[NaturalDelay] Typing delay only (no indicator)');
            await new Promise(resolve => setTimeout(resolve, duration));
            return;
        }
        
        // 🔥 TYPING_INDICATOR_ENABLED=true: Tampilkan "sedang mengetik..." + delay
        logger.debug({ jid: redactPhone(jid), duration }, '[NaturalDelay] Showing typing indicator');
        
        // Tampilkan "sedang mengetik..."
        await session.sendPresenceUpdate('composing', jid);
        
        // Tunggu sesuai durasi
        await new Promise(resolve => setTimeout(resolve, duration));
        
        // Kembali ke status available
        await session.sendPresenceUpdate('available', jid);
        
        logger.debug({ jid: redactPhone(jid) }, '[NaturalDelay] Typing indicator finished');
        
    } catch (error: any) {
        // Jangan throw error jika gagal, cukup log warning
        logger.warn(
            { error: error.message, jid: redactPhone(jid) },
            '[NaturalDelay] Failed to show typing indicator, continuing...'
        );
        // Tetap tunggu delay meskipun indicator gagal
        await new Promise(resolve => setTimeout(resolve, duration));
    }
}

/**
 * Helper untuk mendapatkan info cluster state saat ini
 * Berguna untuk debugging atau monitoring
 */
export function getClusterStateInfo(deviceId: string): ClusterState & { deviceId: string } {
    const state = getClusterState(deviceId);
    return {
        deviceId,
        ...state,
    };
}

/**
 * Helper untuk mendapatkan semua cluster states
 */
export function getAllClusterStates(): Map<string, ClusterState> {
    return new Map(deviceClusterStates);
}

// ============================================
// EXPORTS
// ============================================

export default {
    loadNaturalDelayConfig,
    calculateNaturalDelay,
    sleepWithNaturalDelay,
    showTypingIndicator,
    resetClusterState,
    resetAllClusterStates,
    getClusterStateInfo,
    getAllClusterStates,
};

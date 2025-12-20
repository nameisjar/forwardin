/**
 * Centralized Session State Management
 * 
 * Mengatasi masalah closure stale state pada Baileys event-driven architecture.
 * State disimpan secara terpusat per-session, sehingga semua event handlers
 * selalu mengakses state terbaru melalui referensi Map, bukan captured variable.
 * 
 * @author Generated from Code Review Issue 3.5
 */

import { ConnectionState } from '@whiskeysockets/baileys';
import logger from '../config/logger';

/**
 * State untuk setiap WhatsApp session
 */
export interface SessionState {
    /** Baileys connection state */
    connectionState: Partial<ConnectionState>;
    /** Flag apakah koneksi berhasil (mencegah destroy setelah sukses) */
    connectionSuccessful: boolean;
    /** Session creation timestamp */
    createdAt: Date;
    /** Last state update timestamp */
    updatedAt: Date;
    /** Device ID terkait */
    deviceId: number;
    /** Flag apakah sedang dalam proses reconnect */
    isReconnecting: boolean;
    /** Reconnect attempt counter */
    reconnectAttempts: number;
}

/** Centralized state storage per session */
const sessionStates = new Map<string, SessionState>();

/**
 * Initialize atau get state untuk session
 * Jika state belum ada, akan dibuat dengan default values
 */
export function getOrCreateSessionState(sessionId: string, deviceId: number): SessionState {
    let state = sessionStates.get(sessionId);
    
    if (!state) {
        state = {
            connectionState: { connection: 'close' },
            connectionSuccessful: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            deviceId,
            isReconnecting: false,
            reconnectAttempts: 0,
        };
        sessionStates.set(sessionId, state);
        logger.debug({ sessionId, deviceId }, '[SessionState] Created new session state');
    }
    
    return state;
}

/**
 * Get state untuk session (tanpa auto-create)
 * Returns undefined jika session tidak ada
 */
export function getSessionState(sessionId: string): SessionState | undefined {
    return sessionStates.get(sessionId);
}

/**
 * Update connection state untuk session
 * Akan merge dengan existing state, bukan replace
 */
export function updateConnectionState(
    sessionId: string, 
    update: Partial<ConnectionState>
): SessionState | undefined {
    const state = sessionStates.get(sessionId);
    
    if (!state) {
        logger.warn({ sessionId }, '[SessionState] Attempted to update non-existent session');
        return undefined;
    }
    
    // Merge connection state (Baileys sends partial updates)
    state.connectionState = {
        ...state.connectionState,
        ...update,
    };
    state.updatedAt = new Date();
    
    logger.debug(
        { sessionId, connection: state.connectionState.connection },
        '[SessionState] Connection state updated'
    );
    
    return state;
}

/**
 * Mark session sebagai successfully connected
 */
export function markConnectionSuccessful(sessionId: string): boolean {
    const state = sessionStates.get(sessionId);
    
    if (!state) {
        logger.warn({ sessionId }, '[SessionState] Cannot mark success - session not found');
        return false;
    }
    
    state.connectionSuccessful = true;
    state.isReconnecting = false;
    state.reconnectAttempts = 0;
    state.updatedAt = new Date();
    
    logger.info({ sessionId }, '[SessionState] Connection marked as successful');
    return true;
}

/**
 * Check apakah session sudah pernah berhasil connect
 */
export function isConnectionSuccessful(sessionId: string): boolean {
    return sessionStates.get(sessionId)?.connectionSuccessful ?? false;
}

/**
 * Get current connection status
 */
export function getConnectionStatus(sessionId: string): ConnectionState['connection'] | undefined {
    return sessionStates.get(sessionId)?.connectionState.connection;
}

/**
 * Check apakah session sedang dalam state open/connected
 */
export function isSessionConnected(sessionId: string): boolean {
    return getConnectionStatus(sessionId) === 'open';
}

/**
 * Mark session sebagai sedang reconnecting
 */
export function markReconnecting(sessionId: string): number {
    const state = sessionStates.get(sessionId);
    
    if (!state) {
        logger.warn({ sessionId }, '[SessionState] Cannot mark reconnecting - session not found');
        return 0;
    }
    
    state.isReconnecting = true;
    state.reconnectAttempts += 1;
    state.updatedAt = new Date();
    
    logger.info(
        { sessionId, attempt: state.reconnectAttempts },
        '[SessionState] Session marked as reconnecting'
    );
    
    return state.reconnectAttempts;
}

/**
 * Check apakah session sedang reconnecting
 */
export function isReconnecting(sessionId: string): boolean {
    return sessionStates.get(sessionId)?.isReconnecting ?? false;
}

/**
 * Reset reconnect state (setelah berhasil atau give up)
 */
export function resetReconnectState(sessionId: string): void {
    const state = sessionStates.get(sessionId);
    
    if (state) {
        state.isReconnecting = false;
        state.reconnectAttempts = 0;
        state.updatedAt = new Date();
    }
}

/**
 * Get QR code dari session state
 */
export function getSessionQR(sessionId: string): string | undefined {
    return sessionStates.get(sessionId)?.connectionState.qr;
}

/**
 * Get last disconnect info
 */
export function getLastDisconnect(sessionId: string): ConnectionState['lastDisconnect'] | undefined {
    return sessionStates.get(sessionId)?.connectionState.lastDisconnect;
}

/**
 * Remove session state (cleanup saat destroy)
 */
export function removeSessionState(sessionId: string): boolean {
    const existed = sessionStates.has(sessionId);
    sessionStates.delete(sessionId);
    
    if (existed) {
        logger.info({ sessionId }, '[SessionState] Session state removed');
    }
    
    return existed;
}

/**
 * Get all active session IDs
 */
export function getActiveSessionIds(): string[] {
    return Array.from(sessionStates.keys());
}

/**
 * Get session count
 */
export function getSessionCount(): number {
    return sessionStates.size;
}

/**
 * Get summary of all session states (untuk debugging/monitoring)
 */
export function getSessionStateSummary(): Record<string, {
    connection: string;
    successful: boolean;
    reconnecting: boolean;
    reconnectAttempts: number;
    ageMs: number;
}> {
    const summary: Record<string, any> = {};
    const now = new Date();
    
    for (const [sessionId, state] of sessionStates) {
        summary[sessionId] = {
            connection: state.connectionState.connection || 'unknown',
            successful: state.connectionSuccessful,
            reconnecting: state.isReconnecting,
            reconnectAttempts: state.reconnectAttempts,
            ageMs: now.getTime() - state.createdAt.getTime(),
        };
    }
    
    return summary;
}

/**
 * Clear all session states (untuk testing atau shutdown)
 */
export function clearAllSessionStates(): void {
    const count = sessionStates.size;
    sessionStates.clear();
    logger.info({ clearedCount: count }, '[SessionState] All session states cleared');
}

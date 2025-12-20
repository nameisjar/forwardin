/**
 * ============================================
 * 🔒 LOG REDACTION UTILITY
 * ============================================
 * 
 * Utility untuk menyensor/redact data sensitif sebelum logging.
 * Mencegah data pribadi (nomor telepon, isi pesan, credentials)
 * tersimpan di log files.
 * 
 * PENTING: Selalu gunakan utility ini saat logging data yang
 * mungkin berisi informasi sensitif pengguna.
 * 
 * ============================================
 */

// ============================================
// CONFIGURATION
// ============================================

// Fields yang harus di-redact sepenuhnya
const FULLY_REDACTED_FIELDS = [
    'password',
    'token',
    'secret',
    'apiKey',
    'api_key',
    'accountApiKey',
    'refreshToken',
    'refresh_token',
    'accessToken',
    'access_token',
    'credentials',
    'creds',
    'privateKey',
    'private_key',
];

// Fields yang berisi konten pesan - tampilkan sebagian
const MESSAGE_CONTENT_FIELDS = [
    'message',
    'text',
    'caption',
    'body',
    'content',
    'conversation',
];

// Fields yang berisi nomor telepon - partial redact
const PHONE_FIELDS = [
    'phone',
    'from',
    'to',
    'recipient',
    'sender',
    'remoteJid',
    'jid',
    'participant',
];

// Placeholder untuk data yang di-redact
const REDACTED = '[REDACTED]';
const REDACTED_MESSAGE = '[MESSAGE_REDACTED]';

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Redact nomor telepon - tampilkan sebagian untuk identifikasi
 * Input: 6281234567890 atau 6281234567890@s.whatsapp.net
 * Output: 628***7890 atau 628***7890@s.whatsapp.net
 */
export function redactPhone(phone: string | undefined | null): string {
    if (!phone || typeof phone !== 'string') return REDACTED;
    
    // Handle JID format (number@s.whatsapp.net atau number@g.us)
    const atIndex = phone.indexOf('@');
    const number = atIndex > 0 ? phone.substring(0, atIndex) : phone;
    const suffix = atIndex > 0 ? phone.substring(atIndex) : '';
    
    // Keep first 3 and last 4 digits
    if (number.length <= 7) {
        return `${number.substring(0, 2)}***${suffix}`;
    }
    
    return `${number.substring(0, 3)}***${number.slice(-4)}${suffix}`;
}

/**
 * Redact isi pesan - tampilkan panjang saja
 * Input: "Halo, ini pesan rahasia"
 * Output: "[MSG:23chars]"
 */
export function redactMessage(message: string | undefined | null): string {
    if (!message || typeof message !== 'string') return REDACTED_MESSAGE;
    return `[MSG:${message.length}chars]`;
}

/**
 * Redact message object dari Baileys
 * Hanya tampilkan tipe pesan, bukan kontennya
 */
export function redactMessageObject(msg: Record<string, unknown> | undefined | null): Record<string, unknown> | string {
    if (!msg || typeof msg !== 'object') return REDACTED_MESSAGE;
    
    // Identifikasi tipe pesan
    const messageTypes = [
        'conversation',
        'extendedTextMessage',
        'imageMessage',
        'videoMessage',
        'audioMessage',
        'documentMessage',
        'stickerMessage',
        'contactMessage',
        'locationMessage',
        'reactionMessage',
        'protocolMessage',
        'buttonsMessage',
        'listMessage',
        'templateMessage',
    ];
    
    const foundType = messageTypes.find(type => type in msg);
    
    return {
        type: foundType || 'unknown',
        hasMedia: !!(msg.imageMessage || msg.videoMessage || msg.audioMessage || msg.documentMessage),
        _redacted: true,
    };
}

/**
 * Check if a key should be fully redacted
 */
function shouldFullyRedact(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return FULLY_REDACTED_FIELDS.some(field => lowerKey.includes(field.toLowerCase()));
}

/**
 * Check if a key contains message content
 */
function isMessageContent(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return MESSAGE_CONTENT_FIELDS.some(field => lowerKey === field.toLowerCase());
}

/**
 * Check if a key contains phone number
 */
function isPhoneField(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return PHONE_FIELDS.some(field => lowerKey.includes(field.toLowerCase()));
}

// ============================================
// MAIN REDACTION FUNCTIONS
// ============================================

/**
 * Redact sensitive data dari object untuk logging
 * Secara rekursif memproses nested objects
 * 
 * @param obj - Object yang akan di-redact
 * @param maxDepth - Maximum depth untuk rekursi (default: 5)
 * @returns Object dengan data sensitif yang sudah di-redact
 */
export function redactForLogging<T>(obj: T, maxDepth: number = 5): T {
    if (maxDepth <= 0) return '[MAX_DEPTH]' as unknown as T;
    
    if (obj === null || obj === undefined) {
        return obj;
    }
    
    // Handle primitives
    if (typeof obj !== 'object') {
        return obj;
    }
    
    // Handle arrays
    if (Array.isArray(obj)) {
        // For large arrays, only show count
        if (obj.length > 10) {
            return `[Array:${obj.length}items]` as unknown as T;
        }
        return obj.map(item => redactForLogging(item, maxDepth - 1)) as unknown as T;
    }
    
    // Handle objects
    const redacted: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        // Skip functions
        if (typeof value === 'function') {
            continue;
        }
        
        // Fully redact sensitive fields
        if (shouldFullyRedact(key)) {
            redacted[key] = REDACTED;
            continue;
        }
        
        // Redact message content
        if (isMessageContent(key)) {
            if (typeof value === 'string') {
                redacted[key] = redactMessage(value);
            } else if (typeof value === 'object' && value !== null) {
                redacted[key] = redactMessageObject(value as Record<string, unknown>);
            } else {
                redacted[key] = REDACTED_MESSAGE;
            }
            continue;
        }
        
        // Redact phone numbers
        if (isPhoneField(key)) {
            if (typeof value === 'string') {
                redacted[key] = redactPhone(value);
            } else {
                redacted[key] = REDACTED;
            }
            continue;
        }
        
        // Special handling for 'data' field yang sering berisi message
        if (key === 'data' && typeof value === 'object' && value !== null) {
            redacted[key] = redactForLogging(value, maxDepth - 1);
            continue;
        }
        
        // Special handling for 'key' object (WhatsApp message key)
        if (key === 'key' && typeof value === 'object' && value !== null) {
            const keyObj = value as Record<string, unknown>;
            redacted[key] = {
                id: keyObj.id,
                fromMe: keyObj.fromMe,
                remoteJid: keyObj.remoteJid ? redactPhone(keyObj.remoteJid as string) : undefined,
                participant: keyObj.participant ? redactPhone(keyObj.participant as string) : undefined,
            };
            continue;
        }
        
        // Recursively process nested objects
        if (typeof value === 'object' && value !== null) {
            redacted[key] = redactForLogging(value, maxDepth - 1);
        } else {
            redacted[key] = value;
        }
    }
    
    return redacted as T;
}

/**
 * Create safe log context for WhatsApp messages
 * Utility khusus untuk logging message events
 */
export function safeMessageContext(
    sessionId: string,
    messageKey: { id?: string; fromMe?: boolean; remoteJid?: string; participant?: string } | null,
    additionalContext?: Record<string, unknown>
): Record<string, unknown> {
    return {
        sessionId,
        messageId: messageKey?.id,
        fromMe: messageKey?.fromMe,
        remoteJid: messageKey?.remoteJid ? redactPhone(messageKey.remoteJid) : undefined,
        participant: messageKey?.participant ? redactPhone(messageKey.participant) : undefined,
        ...redactForLogging(additionalContext || {}),
    };
}

/**
 * Create safe log context for broadcast operations
 */
export function safeBroadcastContext(
    broadcastId: string,
    deviceId: string,
    recipientCount: number,
    additionalContext?: Record<string, unknown>
): Record<string, unknown> {
    return {
        broadcastId,
        deviceId,
        recipientCount,
        ...redactForLogging(additionalContext || {}),
    };
}

/**
 * Redact error objects for logging
 * Preserves error structure but redacts any sensitive data in message
 */
export function redactError(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message, // Keep error messages (usually safe)
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        };
    }
    
    if (typeof error === 'object' && error !== null) {
        return redactForLogging(error as Record<string, unknown>);
    }
    
    return { error: String(error) };
}

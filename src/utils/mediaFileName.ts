import path from 'path';

const MAX_FILE_NAME_LENGTH = 255;

function stripControlCharacters(value: string): string {
    return Array.from(value)
        .filter((character) => {
            const code = character.charCodeAt(0);
            return code > 31 && code !== 127;
        })
        .join('');
}

/** Keep a user-facing upload name safe without changing its extension. */
export function sanitizeMediaFileName(
    originalName: string | null | undefined,
    fallback = 'media',
): string {
    const normalized = String(originalName || '').replace(/\\/g, '/');
    const baseName = path.posix.basename(normalized);
    const sanitized = stripControlCharacters(baseName)
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '')
        .trim();

    const safeFallback = stripControlCharacters(String(fallback || 'media'))
        .replace(/[<>:"/\\|?*]/g, '_')
        .trim() || 'media';
    const value = sanitized || safeFallback;

    if (value.length <= MAX_FILE_NAME_LENGTH) return value;

    const extension = path.extname(value);
    const availableBaseLength = Math.max(1, MAX_FILE_NAME_LENGTH - extension.length);
    return `${value.slice(0, availableBaseLength)}${extension}`;
}

/** Resolve the WhatsApp filename, including a safe fallback for legacy rows. */
export function resolveMediaFileName(
    storedOriginalName: string | null | undefined,
    mediaPath: string | null | undefined,
): string | undefined {
    if (storedOriginalName) return sanitizeMediaFileName(storedOriginalName);
    if (!mediaPath) return undefined;
    return sanitizeMediaFileName(mediaPath);
}

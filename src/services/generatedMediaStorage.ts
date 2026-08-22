import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

const safeSegment = (value: string, fallback: string): string => {
    const normalized = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '-');
    return normalized || fallback;
};

const safeExtension = (fileName: string): string => {
    const extension = path.extname(String(fileName || '')).toLowerCase();
    return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '.bin';
};

/**
 * Persist a generated in-memory document under the same media root used by
 * uploaded Inbox attachments. The returned path is deliberately relative to
 * process.cwd(), because OutgoingMessage.mediaPath uses that convention.
 */
export async function persistGeneratedMediaBuffer(
    deviceId: string,
    buffer: Buffer,
    fileName: string,
    baseDirectory = process.cwd(),
): Promise<string> {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('Generated media buffer is empty');
    }

    const deviceDirectory = `D${safeSegment(deviceId, 'unknown')}`;
    const relativeDirectory = path.join('media', deviceDirectory, 'generated');
    const absoluteDirectory = path.resolve(baseDirectory, relativeDirectory);
    await fs.mkdir(absoluteDirectory, { recursive: true });

    const storedFileName = `${Date.now()}-${randomUUID()}${safeExtension(fileName)}`;
    const relativePath = path.join(relativeDirectory, storedFileName);
    await fs.writeFile(path.resolve(baseDirectory, relativePath), buffer, { flag: 'wx' });

    return relativePath.replace(/\\/g, '/');
}

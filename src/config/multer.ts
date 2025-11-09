import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../utils/db'; // lightweight import (already pooled)

// using buffer
const memoryStorage = multer.memoryStorage();

// Resolve device identifier (UUID) best-effort synchronously/with cache.
// We cannot perform async DB calls here, so if we only have a numeric pkId we keep it.
// Prefer the explicit device UUID passed via body / header.
function resolveDeviceSlug(req: any): string {
    // Explicit from multipart body
    let raw = req.body?.deviceId || req.headers['x-device-id'];
    if (!raw && req.authenticatedDevice?.deviceId) {
        // numeric pkId; keep as-is (will differ from UUID but avoids undefined)
        raw = req.authenticatedDevice.deviceId;
    }
    if (!raw) return 'unknown';
    // Sanitize
    raw = String(raw).trim();
    if (!raw) return 'unknown';
    return raw; // Could be UUID or numeric pkId
}

const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        try {
            const deviceSlug = resolveDeviceSlug(req);
            const dir = `media/D${deviceSlug}`;
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            cb(null, dir);
        } catch (err) {
            console.error('Error creating media directory:', err);
            cb(null, 'media');
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    },
});

const memoryUpload = multer({ storage: memoryStorage });
const diskUpload = multer({ storage: diskStorage });

export { memoryUpload, diskUpload };

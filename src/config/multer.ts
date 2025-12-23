import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../utils/db'; // lightweight import (already pooled)

// 🔒 Allowed MIME types for file upload security
const ALLOWED_MIME_TYPES = [
    // Images
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    // Videos
    'video/mp4',
    'video/quicktime',
    'video/webm',
    // Audio
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'audio/webm',
    // Documents
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
    'application/vnd.ms-excel', // xls
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
    'application/msword', // doc
    'text/csv',
    'text/plain',
];

// 🔒 File size limits
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB per file
const MAX_FILES = 10; // Max 10 files per request

// 🔒 File filter to validate MIME types
const fileFilter = (req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(null, true); // Accept file
    } else {
        cb(new Error(`File type '${file.mimetype}' is not allowed. Allowed types: images, videos, audio, PDF, Excel, Word, CSV, TXT`));
    }
};

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
            // console.error('Error creating media directory:', err);
            cb(null, 'media');
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    },
});

const memoryUpload = multer({ 
    storage: memoryStorage,
    fileFilter,
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: MAX_FILES,
    }
});

const diskUpload = multer({ 
    storage: diskStorage,
    fileFilter,
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: MAX_FILES,
    }
});

export { memoryUpload, diskUpload };

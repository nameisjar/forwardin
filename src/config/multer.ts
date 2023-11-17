import multer from 'multer';
import path from 'path';
import fs from 'fs';

// using buffer
const memoryStorage = multer.memoryStorage();

// using url
const dir = '.tmp';
if (!fs.existsSync(dir)) {
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
        console.error('Error creating directory:', err);
    }
}

const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    },
});
const memoryUpload = multer({ storage: memoryStorage });
const diskUpload = multer({ storage: diskStorage });

export { memoryUpload, diskUpload };

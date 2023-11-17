import multer from 'multer';
import path from 'path';
import fs from 'fs';

// using buffer
const memoryStorage = multer.memoryStorage();

// using url

const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = `media/D${req.body.deviceId}`;
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
            } catch (err) {
                console.error('Error creating directory:', err);
            }
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    },
});

const memoryUpload = multer({ storage: memoryStorage });
const diskUpload = multer({ storage: diskStorage });

export { memoryUpload, diskUpload };

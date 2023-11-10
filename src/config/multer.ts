import multer from 'multer';
// import path from 'path';
// import fs from 'fs';

// using buffer
const storage = multer.memoryStorage();

// using url
// const dir = '.tmp/uploads';
// if (!fs.existsSync(dir)) {
//     try {
//         fs.mkdirSync(dir, { recursive: true });
//     } catch (err) {
//         console.error('Error creating directory:', err);
//     }
// }

// const storage = multer.diskStorage({
//     destination: (req, file, cb) => {
//         cb(null, dir);
//     },
//     filename: (req, file, cb) => {
//         const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
//         cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
//     },
// });
const upload = multer({ storage: storage });

export default upload;

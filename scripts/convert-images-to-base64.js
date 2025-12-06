const fs = require('fs');
const path = require('path');

const assetsPath = path.join(__dirname, '../../fe-autosender/src/assets');
const outputPath = path.join(__dirname, '../templates/images-base64.json');

const imageFiles = [
  'cellImage_1836760394_0.jpg',
  'cellImage_1836760394_1.jpg',
  'cellImage_1836760394_3.jpg',
  'cellImage_1836760394_5.jpg',
  'cellImage_1836760394_6.jpg',
  'cellImage_1836760394_7.jpg',
  'cellImage_1836760394_8.jpg',
  'gambar jalur pendidikan.jpeg',
  'logo autosender.png'
];

const images = {};

imageFiles.forEach(fileName => {
  const filePath = path.join(assetsPath, fileName);
  if (fs.existsSync(filePath)) {
    const imageBuffer = fs.readFileSync(filePath);
    const base64 = imageBuffer.toString('base64');
    const ext = path.extname(fileName).slice(1);
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
    
    // Remove extension and special characters for key name
    const key = fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_');
    images[key] = `data:${mimeType};base64,${base64}`;
    
    // console.log(`✓ Converted ${fileName}`);
  } else {
    // console.log(`✗ File not found: ${fileName}`);
  }
});

fs.writeFileSync(outputPath, JSON.stringify(images, null, 2));
// console.log(`\n✓ Images saved to ${outputPath}`);

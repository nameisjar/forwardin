const fs = require('fs');
const path = require('path');

// Use local assets folder in backend project instead of frontend
const assetsPath = path.join(__dirname, 'assets');
const outputPath = path.join(__dirname, '../templates/images-base64.json');

console.log('🔄 Starting image conversion...');
console.log('📁 Assets path:', assetsPath);
console.log('📄 Output path:', outputPath);

// Check if assets directory exists
if (!fs.existsSync(assetsPath)) {
    console.error('❌ Assets directory not found:', assetsPath);
    console.log('⚠️  Creating empty images-base64.json file...');
    fs.writeFileSync(outputPath, JSON.stringify({}, null, 2));
    console.error('⚠️  WARNING: No images will be available in templates!');
    process.exit(0); // Exit with success to allow build to continue
}

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
let successCount = 0;
let failCount = 0;

imageFiles.forEach(fileName => {
    const filePath = path.join(assetsPath, fileName);
    if (fs.existsSync(filePath)) {
        try {
            const imageBuffer = fs.readFileSync(filePath);
            const base64 = imageBuffer.toString('base64');
            const ext = path.extname(fileName).slice(1);
            const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
            
            // Remove extension and special characters for key name
            const key = fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_');
            images[key] = `data:${mimeType};base64,${base64}`;
            
            console.log(`✅ Converted: ${fileName} (${(imageBuffer.length / 1024).toFixed(2)} KB)`);
            successCount++;
        } catch (error) {
            console.error(`❌ Error converting ${fileName}:`, error.message);
            failCount++;
        }
    } else {
        console.log(`⚠️  File not found: ${fileName}`);
        failCount++;
    }
});

try {
    // Ensure templates directory exists
    const templatesDir = path.dirname(outputPath);
    if (!fs.existsSync(templatesDir)) {
        fs.mkdirSync(templatesDir, { recursive: true });
        console.log('📁 Created templates directory');
    }
    
    fs.writeFileSync(outputPath, JSON.stringify(images, null, 2));
    console.log(`\n✅ Successfully saved ${successCount} images to images-base64.json`);
    
    if (failCount > 0) {
        console.log(`⚠️  ${failCount} files were not found or failed to convert`);
    }
    
    // Show file size
    const stats = fs.statSync(outputPath);
    console.log(`📊 Output file size: ${(stats.size / 1024).toFixed(2)} KB`);
    
} catch (error) {
    console.error('❌ Error writing output file:', error.message);
    process.exit(1);
}

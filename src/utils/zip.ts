import JSZip from 'jszip';
import fs from 'fs';

export async function createZipFile(dataMessages: string, mediaPaths: string[]): Promise<Buffer> {
    const zip = new JSZip();
    zip.file('messages.txt', dataMessages);

    const folderMedia = zip.folder('media');
    if (folderMedia) {
        for (let i = 0; i < mediaPaths.length; i++) {
            const imagePath = mediaPaths[i];
            if (fs.existsSync(imagePath)) {
                const imageBuffer = fs.readFileSync(imagePath); // Read the image file
                folderMedia.file(`${i}.jpg`, imageBuffer); // Add the image file to the ZIP
            }
        }
    }

    const zipContent = await zip.generateAsync({ type: 'nodebuffer' });
    return zipContent;
}

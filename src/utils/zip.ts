import JSZip from 'jszip';
import fs from 'fs';
import { saveAs } from 'file-saver';

export async function createZipFile(phoneNumber: string) {
    const zip = new JSZip();

    // Menambahkan file ke ZIP dari data array yang di kirim
    zip.file(`WhatsApp Chat with Contact +${phoneNumber}.txt`, 'apa kabar');
    // zip.file(`WhatsApp Chat with Contact +${phoneNumber}.txt`, text);

    // menambahkan image dari chat conversation ke ZIP dari aplikasi local saya jika di deploy ke server maka harus di sesuaikan
    // const folderMedia = zip.folder('media');
    // if (folderMedia) {
    //     media.forEach((image, index) => {
    //         // Menambahkan file ke ZIP
    //         const imageBuffer = fs.readFileSync(image); // Read the image file
    //         folderMedia.file(`${index}.jpg`, imageBuffer); // Add the image file to the ZIP
    //     });
    // }

    zip.generateAsync({ type: 'blob' }).then(function (content) {
        // Force down of the Zip file
        saveAs(content, 'archive.zip');
    });
    // const content = await zip.generateAsync({ type: 'blob' });
    // return content;
}

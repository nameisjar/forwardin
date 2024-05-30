import JSZip from 'jszip';
import fs from 'fs';

export async function createZipFile(phoneNumber: string, dataMessages: string) {
    const zip = new JSZip();

    // Menambahkan file ke ZIP
    zip.file(`WhatsApp Chat with Contact +${phoneNumber}.txt`, dataMessages);

    // menambahkan image dari chat conversation ke ZIP dari aplikasi local saya jika di deploy ke server maka harus di sesuaikan
    // const folderMedia = zip.folder('media');
    // if (folderMedia) {
    //     media.forEach((image, index) => {
    //         // Menambahkan file ke ZIP
    //         const imageBuffer = fs.readFileSync(image); // Read the image file
    //         folderMedia.file(`${index}.jpg`, imageBuffer); // Add the image file to the ZIP
    //     });
    // }

    // Mengenerate ZIP dan mengunduhnya
    const content = await zip.generateAsync({ type: 'blob' });
    return content;
}

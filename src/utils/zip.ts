import JSZip from 'jszip';

export async function createZipFile(phoneNumber: string, dataMessages: string) {
    const zip = new JSZip();

    // Menambahkan file ke ZIP
    zip.file(`WhatsApp Chat with Contact +${phoneNumber}.txt`, dataMessages);

    // Mengenerate ZIP dan mengunduhnya
    const content = await zip.generateAsync({ type: 'nodebuffer' });
    return content;
}

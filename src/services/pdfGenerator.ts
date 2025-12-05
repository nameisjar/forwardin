import PDFDocument from 'pdfkit';
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs/promises';

interface MonthlyFeedbackData {
    studentName: string;
    courseName: string;
    month: number;
    duration: string;
    level: string;
    code: string;
    topicModule: string;
    result: string;
    skillsAcquired: string;
    youtubeLink: string;
    referralLink: string;
    tutorComment: string;
    rating?: number;      // 🆕 Rating bintang (1-5)
    reportBy?: string;    // 🆕 Laporan dibuat oleh
}

/**
 * Generate PDF using Puppeteer (renders HTML to PDF)
 * This produces a PDF that matches the preview exactly
 */
export const generateMonthlyFeedbackPDFWithPuppeteer = async (data: MonthlyFeedbackData): Promise<Buffer> => {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 794, height: 1123 }); // A4 size in pixels

        // Read the template HTML
        const templatePath = path.join(__dirname, '../../templates/monthly-feedback-template.html');
        let htmlContent = await fs.readFile(templatePath, 'utf-8');

        // Load base64 images
        const imagesPath = path.join(__dirname, '../../templates/images-base64.json');
        const imagesBase64 = JSON.parse(await fs.readFile(imagesPath, 'utf-8'));

        // Replace placeholders with actual data
        htmlContent = htmlContent
            .replace(/\{\{studentName\}\}/g, data.studentName)
            .replace(/\{\{courseName\}\}/g, data.courseName)
            .replace(/\{\{duration\}\}/g, data.duration)
            .replace(/\{\{level\}\}/g, data.level)
            .replace(/\{\{month\}\}/g, String(data.month))
            .replace(/\{\{code\}\}/g, data.code)
            .replace(/\{\{topicModule\}\}/g, data.topicModule)
            .replace(/\{\{result\}\}/g, data.result)
            .replace(/\{\{skillsAcquired\}\}/g, data.skillsAcquired)
            .replace(/\{\{youtubeLink\}\}/g, data.youtubeLink)
            .replace(/\{\{referralLink\}\}/g, data.referralLink)
            .replace(/\{\{tutorComment\}\}/g, data.tutorComment)
            .replace(/\{\{rating\}\}/g, String(data.rating || 5))  // 🆕 Rating bintang (default 5)
            .replace(/\{\{reportBy\}\}/g, data.reportBy || 'Tutor')  // 🆕 Laporan dibuat oleh (default 'Tutor')
            // Images
            .replace(/\{\{headerImage\}\}/g, imagesBase64.cellImage_1836760394_0 || '')
            .replace(/\{\{educationPathImage\}\}/g, imagesBase64.gambar_jalur_pendidikan || '')
            // Icons
            .replace(/\{\{trophyIcon\}\}/g, imagesBase64.cellImage_1836760394_1 || '')
            .replace(/\{\{linkIcon\}\}/g, imagesBase64.cellImage_1836760394_8 || '')
            .replace(/\{\{skillsIcon\}\}/g, imagesBase64.cellImage_1836760394_6 || '')
            .replace(/\{\{freeLessonGiftIcon\}\}/g, imagesBase64.cellImage_1836760394_3 || '')
            .replace(/\{\{aboutModuleIcon\}\}/g, imagesBase64.cellImage_1836760394_5 || '')
            .replace(/\{\{feedbackIcon\}\}/g, imagesBase64.cellImage_1836760394_7 || '');

        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

        // Generate PDF
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '0mm',
                bottom: '0mm',
                left: '0mm',
                right: '0mm'
            }
        });

        await browser.close();
        return Buffer.from(pdfBuffer);
    } catch (error) {
        if (browser) await browser.close();
        throw error;
    }
};

export const generateMonthlyFeedbackPDF = async (data: MonthlyFeedbackData): Promise<Buffer> => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                margins: {
                    top: 50,
                    bottom: 50,
                    left: 50,
                    right: 50
                }
            });

            const chunks: Buffer[] = [];

            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // Header
            doc.fontSize(24)
               .fillColor('#3B82F6')
               .text('FEEDBACK BULANAN', { align: 'center' })
               .moveDown(0.5);

            doc.fontSize(16)
               .fillColor('#64748B')
               .text('Algorithmics Programming School', { align: 'center' })
               .moveDown(2);

            // Student Info Section
            doc.fontSize(14)
               .fillColor('#1E293B')
               .text('Informasi Siswa', { underline: true })
               .moveDown(0.5);

            const infoFields = [
                ['Nama Siswa', data.studentName],
                ['Nama Kursus', data.courseName],
                ['Lama Pelatihan', data.duration],
                ['Level', data.level],
                ['Code', data.code]
            ];

            doc.fontSize(11).fillColor('#475569');
            infoFields.forEach(([label, value]) => {
                doc.text(`${label}: `, { continued: true, width: 150 })
                   .fillColor('#1E293B')
                   .text(value || '-')
                   .fillColor('#475569')
                   .moveDown(0.3);
            });

            doc.moveDown(1);

            // Learning Material Section
            doc.fontSize(14)
               .fillColor('#1E293B')
               .text('Materi Pembelajaran', { underline: true })
               .moveDown(0.5);

            doc.fontSize(11)
               .fillColor('#475569')
               .text('Topik Modul:', { underline: true })
               .moveDown(0.3)
               .fillColor('#334155')
               .text(data.topicModule || '-', { align: 'justify' })
               .moveDown(0.5);

            doc.fillColor('#475569')
               .text('Hasil:', { underline: true })
               .moveDown(0.3)
               .fillColor('#334155')
               .text(data.result || '-', { align: 'justify' })
               .moveDown(0.5);

            doc.fillColor('#475569')
               .text('Keahlian yang Didapatkan:', { underline: true })
               .moveDown(0.3)
               .fillColor('#334155')
               .text(data.skillsAcquired || '-', { align: 'justify' })
               .moveDown(1);

            // Tutor Feedback Section
            doc.fontSize(14)
               .fillColor('#1E293B')
               .text('Feedback Tutor', { underline: true })
               .moveDown(0.5);

            doc.fontSize(11)
               .fillColor('#334155')
               .text(data.tutorComment, { align: 'justify' })
               .moveDown(1);

            // Links Section
            doc.fontSize(14)
               .fillColor('#1E293B')
               .text('Tautan Penting', { underline: true })
               .moveDown(0.5);

            doc.fontSize(11)
               .fillColor('#475569')
               .text('Video Proyek Akhir:', { continued: true })
               .fillColor('#3B82F6')
               .text(` ${data.youtubeLink}`, { link: data.youtubeLink })
               .moveDown(0.3);

            doc.fillColor('#475569')
               .text('Link Referral Tutor:', { continued: true })
               .fillColor('#3B82F6')
               .text(` ${data.referralLink}`, { link: data.referralLink })
               .moveDown(2);

            // Footer
            const currentDate = new Date().toLocaleDateString('id-ID', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            doc.fontSize(9)
               .fillColor('#94A3B8')
               .text(`Dibuat pada: ${currentDate}`, { align: 'center' })
               .moveDown(0.3)
               .text('© 2024 Algorithmics Programming School', { align: 'center' });

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};

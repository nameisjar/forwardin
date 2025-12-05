import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';
import { sendDocument } from '../services/whatsapp';
import { generateMonthlyFeedbackPDFWithPuppeteer, generateMonthlyFeedbackPDF } from '../services/pdfGenerator';

// Send monthly feedback with PDF
export const sendMonthlyFeedback: RequestHandler = async (req, res) => {
    try {
        logger.info('=== Starting monthly feedback send ===');
        logger.info('Request body:', JSON.stringify(req.body, null, 2));

        const {
            studentName,
            courseName,
            month,
            duration,
            level,
            code,
            topicModule,
            result,
            skillsAcquired,
            youtubeLink,
            referralLink,
            tutorComment,
            recipientPhone, // 🔄 Keep for backward compatibility
            recipients,     // 🆕 New: support multiple recipients
            deviceId,
            rating,         // 🆕 Rating bintang (1-5)
            reportBy        // 🆕 Laporan dibuat oleh
        } = req.body;

        // 🆕 Support both single and multiple recipients
        const recipientList = recipients && Array.isArray(recipients) && recipients.length > 0 
            ? recipients 
            : (recipientPhone ? [recipientPhone] : []);

        // Validate required fields
        if (!studentName || !courseName || !month || recipientList.length === 0 || !tutorComment) {
            logger.warn('Missing required fields:', {
                hasStudentName: !!studentName,
                hasCourseName: !!courseName,
                hasMonth: !!month,
                hasRecipients: recipientList.length > 0,
                hasTutorComment: !!tutorComment
            });
            return res.status(400).json({ 
                message: 'Missing required fields',
                details: {
                    studentName: !studentName ? 'required' : 'ok',
                    courseName: !courseName ? 'required' : 'ok',
                    month: !month ? 'required' : 'ok',
                    recipients: recipientList.length === 0 ? 'required (at least 1)' : 'ok',
                    tutorComment: !tutorComment ? 'required' : 'ok'
                }
            });
        }

        // Validate device ID
        if (!deviceId) {
            logger.warn('Device ID is missing');
            return res.status(400).json({ 
                message: 'Device ID is required' 
            });
        }

        logger.info('Device ID:', deviceId);
        logger.info('Recipients count:', recipientList.length);

        // Check if device exists
        const device = await prisma.device.findUnique({
            where: { id: deviceId }
        });

        if (!device) {
            logger.error('Device not found:', deviceId);
            return res.status(404).json({ 
                message: 'Device not found',
                deviceId 
            });
        }

        logger.info('Device found:', device.name);

        // Generate PDF using Puppeteer (matches preview exactly)
        logger.info('Generating PDF with Puppeteer...');
        let pdfBuffer;
        
        try {
            pdfBuffer = await generateMonthlyFeedbackPDFWithPuppeteer({
                studentName,
                courseName,
                month: Number(month),
                duration: duration || `Bulan ke-${month}`,
                level: level || '',
                code: code || '',
                topicModule: topicModule || '',
                result: result || '',
                skillsAcquired: skillsAcquired || '',
                youtubeLink: youtubeLink || '',
                referralLink: referralLink || '',
                tutorComment: tutorComment || '',
                rating: rating || 5,           // 🆕 Pass rating to PDF generator
                reportBy: reportBy || 'Tutor'  // 🆕 Pass reportBy to PDF generator
            });
            logger.info('PDF generated with Puppeteer successfully, size:', pdfBuffer.length, 'bytes');
        } catch (puppeteerError) {
            logger.warn('Puppeteer failed, falling back to PDFKit:', puppeteerError);
            // Fallback to PDFKit if Puppeteer fails
            pdfBuffer = await generateMonthlyFeedbackPDF({
                studentName,
                courseName,
                month: Number(month),
                duration: duration || `Bulan ke-${month}`,
                level: level || '',
                code: code || '',
                topicModule: topicModule || '',
                result: result || '',
                skillsAcquired: skillsAcquired || '',
                youtubeLink: youtubeLink || '',
                referralLink: referralLink || '',
                tutorComment: tutorComment || '',
                rating: rating || 5,           // 🆕 Pass rating to PDF generator
                reportBy: reportBy || 'Tutor'  // 🆕 Pass reportBy to PDF generator
            });
            logger.info('PDF generated with PDFKit successfully, size:', pdfBuffer.length, 'bytes');
        }

        // 🆕 Send PDF to all recipients
        const fileName = `Feedback_${studentName.replace(/\s+/g, '_')}_${courseName.replace(/\s+/g, '_')}_Bulan${month}.pdf`;
        
        // 🔥 UPDATE: Caption yang lebih personal dan profesional
        const tutorName = reportBy || 'Tutor';
        const caption = `Halo, Ayah/Bunda dari ${studentName}! 👋

Saya ${tutorName}, tutor ${studentName} di Sekolah Pemrograman Internasional Algorithmics.

Saya ingin berbagi kabar tentang perkembangan ${studentName} selama satu bulan terakhir. Kami telah menilai kemajuan ${studentName} berdasarkan keterampilan yang dipelajari di kelas, serta upaya yang telah ditunjukkan dalam menyelesaikan berbagai tugas. 😊 Hasil lengkapnya bisa Anda lihat pada lampiran yang sudah kami sediakan 📄.

Penilaian ini meliputi bintang dan poin yang diperoleh ${studentName} atas kinerja dalam berbagai keterampilan utama yang diajarkan di kelas. Bintang tersebut merefleksikan seberapa baik ${studentName} menguasai materi dan menerapkan keterampilannya, baik dalam tugas rumah maupun tugas kelas. Poin tambahan juga diberikan sebagai penghargaan atas kerja keras dan ketekunan yang ditunjukkan oleh ${studentName}.

Jika ada hal yang ingin ditanyakan mengenai hasil ini atau tentang perkembangan ${studentName}, saya siap membantu menjelaskan lebih lanjut. Terima kasih atas dukungan Anda dalam proses belajar ${studentName}, dan mari kita terus bekerja sama untuk mencapai hasil yang lebih baik ke depannya! 💜`;
        
        logger.info('Sending document to', recipientList.length, 'recipient(s)...');
        
        const sendResults = [];
        for (const recipient of recipientList) {
            try {
                logger.info('Sending to:', recipient);
                await sendDocument(
                    deviceId,
                    recipient,
                    pdfBuffer,
                    fileName,
                    caption
                );
                sendResults.push({ recipient, status: 'success' });
                logger.info('✅ Sent to:', recipient);
                
                // Small delay between sends to avoid rate limiting
                if (recipientList.length > 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            } catch (sendError) {
                logger.error('❌ Failed to send to:', recipient, sendError);
                sendResults.push({ 
                    recipient, 
                    status: 'failed', 
                    error: sendError instanceof Error ? sendError.message : 'Unknown error' 
                });
            }
        }

        logger.info('Send results:', sendResults);

        // Log to database (optional - won't fail if table doesn't exist)
        try {
            // Check if user is authenticated
            if (req.authenticatedUser && req.authenticatedUser.id) {
                // 🆕 Log each successful send
                for (const result of sendResults) {
                    if (result.status === 'success') {
                        await prisma.monthlyFeedbackLog.create({
                            data: {
                                studentName,
                                courseName,
                                month: Number(month),
                                recipientPhone: result.recipient,
                                sentBy: req.authenticatedUser.id,
                                sentAt: new Date()
                            }
                        });
                    }
                }
                logger.info('Feedback logged to database');
            } else {
                logger.warn('User not authenticated, skipping database logging');
            }
        } catch (err) {
            // Log error but don't fail the request
            logger.error('Error logging monthly feedback to database:', err);
            logger.info('Continuing without database logging...');
        }

        const successCount = sendResults.filter(r => r.status === 'success').length;
        const failedCount = sendResults.filter(r => r.status === 'failed').length;

        logger.info(`=== Monthly feedback sent: ${successCount} success, ${failedCount} failed ===`);
        
        res.status(200).json({ 
            message: `Monthly feedback sent to ${successCount} recipient(s)`,
            fileName,
            results: sendResults,
            summary: {
                total: recipientList.length,
                success: successCount,
                failed: failedCount
            }
        });
    } catch (error) {
        logger.error('=== Error sending monthly feedback ===');
        logger.error('Error type:', error?.constructor?.name);
        logger.error('Error message:', error instanceof Error ? error.message : 'Unknown error');
        logger.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        
        res.status(500).json({ 
            message: 'Failed to send monthly feedback',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

// Get monthly feedback logs
export const getMonthlyFeedbackLogs: RequestHandler = async (req, res) => {
    try {
        const userId = req.authenticatedUser.pkId;
        const isAdmin = req.privilege.pkId === Number(process.env.ADMIN_ID);

        const logs = await prisma.monthlyFeedbackLog.findMany({
            where: isAdmin ? {} : { sentBy: req.authenticatedUser.id },
            orderBy: {
                sentAt: 'desc'
            },
            take: 100
        });

        res.status(200).json({ logs });
    } catch (error) {
        logger.error('Error fetching monthly feedback logs:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

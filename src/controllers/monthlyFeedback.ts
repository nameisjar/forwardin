import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';
import { sendDocument } from '../services/whatsapp';
import { generateMonthlyFeedbackPDFWithPuppeteer } from '../services/pdfGenerator';
import { executeWithRateLimit, RateLimitResult, setDeviceAsPersonal, setDeviceAsShared } from '../services/rateLimiter';
import { redactPhone } from '../utils/logRedaction';

// 🔥 Environment variables untuk role checking
const ADMIN_ID = Number(process.env.ADMIN_ID);
const SUPER_ADMIN_ID = Number(process.env.SUPER_ADMIN_ID);

// 🔥 Helper function untuk check apakah user adalah admin
function isAdminUser(privilegeId: number | undefined): boolean {
    if (!privilegeId) return false;
    return privilegeId === ADMIN_ID || privilegeId === SUPER_ADMIN_ID;
}

// 🔥 Helper function untuk set device rate limit berdasarkan role user
function configureDeviceRateLimit(deviceId: string, privilegeId: number | undefined): void {
    if (isAdminUser(privilegeId)) {
        // Admin/Super Admin → Shared Device (lebih longgar: 20 msg/min)
        setDeviceAsShared(deviceId);
        logger.info(`[RateLimit] Device ${deviceId} configured as SHARED (Admin user)`);
    } else {
        // Tutor → Personal Device (lebih konservatif: 10 msg/min)
        setDeviceAsPersonal(deviceId);
        logger.info(`[RateLimit] Device ${deviceId} configured as PERSONAL (Tutor user)`);
    }
}

// 🔥 Helper function untuk expand label menjadi daftar nomor kontak
async function expandLabelToContacts(labelName: string, deviceId: string): Promise<string[]> {
    try {
        // Cari kontak yang memiliki label ini DAN terhubung ke device ini
        const contactsWithLabel = await prisma.contact.findMany({
            where: {
                ContactLabel: {
                    some: {
                        label: {
                            name: {
                                equals: labelName,
                                mode: 'insensitive'
                            }
                        }
                    }
                },
                contactDevices: {
                    some: {
                        device: {
                            id: deviceId
                        }
                    }
                }
            },
            select: {
                phone: true
            }
        });

        // Extract nomor telepon
        const phones = contactsWithLabel
            .map(contact => contact.phone)
            .filter((phone): phone is string => !!phone && phone.length > 0);

        logger.info(`Label "${labelName}" expanded to ${phones.length} contacts for device ${deviceId}`);
        return phones;
    } catch (error) {
        logger.error(`Error expanding label "${labelName}":`, error);
        return [];
    }
}

// 🔥 Helper function untuk memproses recipients (expand label jika ada)
async function processRecipients(recipients: string[], deviceId: string): Promise<string[]> {
    const processedRecipients: string[] = [];

    for (const recipient of recipients) {
        if (typeof recipient === 'string' && recipient.toLowerCase().startsWith('label_')) {
            // Extract nama label (hapus prefix "label_")
            const labelName = recipient.slice(6);
            logger.info(`Expanding label: ${labelName}`);
            
            const labelContacts = await expandLabelToContacts(labelName, deviceId);
            processedRecipients.push(...labelContacts);
        } else {
            // Bukan label, tambahkan langsung
            processedRecipients.push(recipient);
        }
    }

    // Hapus duplikat
    const uniqueRecipients = [...new Set(processedRecipients)];
    logger.info(`Processed recipients: ${recipients.length} input -> ${uniqueRecipients.length} unique recipients`);
    
    return uniqueRecipients;
}

// Send monthly feedback with PDF
export const sendMonthlyFeedback: RequestHandler = async (req, res) => {
    try {
        logger.info('=== Starting monthly feedback send ===');
        
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
            recipientPhone,
            recipients,
            deviceId,
            rating,
            reportBy
        } = req.body;

        // Log hanya field penting (bukan full request body)
        logger.info('Request:', { studentName: studentName?.substring(0, 2) + '***', courseName, month, deviceId, recipientCount: recipients?.length || (recipientPhone ? 1 : 0) });

        const rawRecipientList = recipients && Array.isArray(recipients) && recipients.length > 0 
            ? recipients 
            : (recipientPhone ? [recipientPhone] : []);

        if (!studentName || !courseName || !month || rawRecipientList.length === 0 || !tutorComment) {
            logger.warn('Missing required fields');
            return res.status(400).json({ 
                message: 'Missing required fields',
                details: {
                    studentName: !studentName ? 'required' : 'ok',
                    courseName: !courseName ? 'required' : 'ok',
                    month: !month ? 'required' : 'ok',
                    recipients: rawRecipientList.length === 0 ? 'required (at least 1)' : 'ok',
                    tutorComment: !tutorComment ? 'required' : 'ok'
                }
            });
        }

        if (!deviceId) {
            logger.warn('Device ID is missing');
            return res.status(400).json({ message: 'Device ID is required' });
        }

        // Verify device exists AND belongs to current user (IDOR protection)
        const device = await prisma.device.findFirst({
            where: { 
                id: deviceId,
                userId: req.authenticatedUser.pkId,
            }
        });

        if (!device) {
            logger.error('Device not found or access denied:', deviceId);
            return res.status(404).json({ message: 'Device not found or access denied', deviceId });
        }

        logger.info('Device found:', device.name);

        // 🔥 Configure device rate limit based on user role
        configureDeviceRateLimit(deviceId, req.privilege.pkId);

        // 🔥 Process recipients - expand labels to actual phone numbers
        const recipientList = await processRecipients(rawRecipientList, deviceId);

        if (recipientList.length === 0) {
            logger.warn('No valid recipients after processing labels');
            return res.status(400).json({ 
                message: 'No valid recipients found. Labels may be empty or contacts not found.',
                originalRecipients: rawRecipientList
            });
        }

        // Generate PDF
        logger.info('Generating PDF with Puppeteer...');
        const pdfBuffer = await generateMonthlyFeedbackPDFWithPuppeteer({
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
            rating: rating || 5,
            reportBy: reportBy || 'Tutor'
        });
        logger.info('PDF generated successfully, size:', pdfBuffer.length, 'bytes');

        const fileName = `Feedback_${studentName.replace(/\s+/g, '_')}_${courseName.replace(/\s+/g, '_')}_Bulan${month}.pdf`;
        
        const tutorName = reportBy || 'Tutor';
        const caption = `Halo, Ayah/Bunda dari ${studentName}! 👋

Saya ${tutorName}, tutor ${studentName} di Sekolah Pemrograman Internasional Algorithmics.

Saya ingin berbagi kabar tentang perkembangan ${studentName} selama satu bulan terakhir. Kami telah menilai kemajuan ${studentName} berdasarkan keterampilan yang dipelajari di kelas, serta upaya yang telah ditunjukkan dalam menyelesaikan berbagai tugas. 😊 Hasil lengkapnya bisa Anda lihat pada lampiran yang sudah kami sediakan 📄.

Penilaian ini meliputi bintang dan poin yang diperoleh ${studentName} atas kinerja dalam berbagai keterampilan utama yang diajarkan di kelas. Bintang tersebut merefleksikan seberapa baik ${studentName} menguasai materi dan menerapkan keterampilannya, baik dalam tugas rumah maupun tugas kelas. Poin tambahan juga diberikan sebagai penghargaan atas kerja keras dan ketekunan yang ditunjukkan oleh ${studentName}.

Jika ada hal yang ingin ditanyakan mengenai hasil ini atau tentang perkembangan ${studentName}, saya siap membantu menjelaskan lebih lanjut. Terima kasih atas dukungan Anda dalam proses belajar ${studentName}, dan mari kita terus bekerja sama untuk mencapai hasil yang lebih baik ke depannya! 💜`;
        
        logger.info('Sending document to', recipientList.length, 'recipient(s)...');
        
        const sendResults: Array<{
            recipient: string;
            status: string;
            error?: string;
            rateLimitInfo?: RateLimitResult;
        }> = [];

        for (const recipient of recipientList) {
            try {
                logger.info('Sending to:', redactPhone(recipient));
                
                // 🔥 Menggunakan rate limiter untuk pengiriman WhatsApp
                const { result: sendResult, rateLimitInfo } = await executeWithRateLimit(
                    deviceId,
                    async () => {
                        await sendDocument(
                            deviceId,
                            recipient,
                            pdfBuffer,
                            fileName,
                            caption
                        );
                        return { success: true };
                    },
                    `feedback-${studentName}-${recipient}-${Date.now()}`
                );
                
                sendResults.push({ 
                    recipient, 
                    status: 'success',
                    rateLimitInfo
                });
                
                // Log info rate limit jika ada delay
                if (rateLimitInfo.delayed) {
                    logger.info(`✅ Sent to ${redactPhone(recipient)} (delayed ${Math.round(rateLimitInfo.delayMs/1000)}s)`);
                } else {
                    logger.info('✅ Sent to:', redactPhone(recipient));
                }
                
            } catch (sendError) {
                logger.error('❌ Failed to send to:', redactPhone(recipient), sendError);
                sendResults.push({ 
                    recipient, 
                    status: 'failed', 
                    error: sendError instanceof Error ? sendError.message : 'Unknown error' 
                });
            }
        }

        // Log to database
        try {
            if (req.authenticatedUser && req.authenticatedUser.id) {
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
            }
        } catch (err) {
            logger.error('Error logging to database:', err);
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
        logger.error('Error:', error instanceof Error ? error.message : 'Unknown error');
        
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

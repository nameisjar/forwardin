import { RequestHandler } from 'express';
import JSZip from 'jszip';
import logger from '../config/logger';
import { generateMonthlyFeedbackPDFWithPuppeteer } from '../services/pdfGenerator';

export interface CustomFeedbackStudent {
    studentName: string;
    courseName: string;
    month: number;
    duration?: string;
    level?: string;
    code?: string;
    topicModule?: string;
    result?: string;
    skillsAcquired?: string;
    youtubeLink: string;
    referralLink: string;
    tutorComment: string;
    rating?: number;
    reportBy?: string;
}

const MAX_STUDENTS_PER_DOWNLOAD = 100;
const MAX_TEXT_LENGTH = 12_000;

const asCleanString = (value: unknown, maxLength = MAX_TEXT_LENGTH): string =>
    String(value ?? '').trim().slice(0, maxLength);

const isHttpUrl = (value: string): boolean => {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
};

const safeFilePart = (value: string): string => {
    const cleaned = value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[<>:"/\\|?*]/g, '')
        .split('')
        .filter((character) => character.charCodeAt(0) >= 32)
        .join('')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^[_ .]+|[_ .]+$/g, '')
        .slice(0, 80);

    return cleaned || 'Siswa';
};

export const normalizeCustomFeedbackStudent = (
    raw: unknown,
    index: number,
): CustomFeedbackStudent => {
    const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const month = Number(input.month);
    const rating = Number(input.rating ?? 5);

    const student: CustomFeedbackStudent = {
        studentName: asCleanString(input.studentName, 180),
        courseName: asCleanString(input.courseName, 180),
        month,
        duration: asCleanString(input.duration, 180),
        level: asCleanString(input.level, 180),
        code: asCleanString(input.code, 180),
        topicModule: asCleanString(input.topicModule),
        result: asCleanString(input.result),
        skillsAcquired: asCleanString(input.skillsAcquired),
        youtubeLink: asCleanString(input.youtubeLink, 2_000),
        referralLink: asCleanString(input.referralLink, 2_000),
        tutorComment: asCleanString(input.tutorComment),
        rating,
        reportBy: asCleanString(input.reportBy, 180) || 'Tutor',
    };

    const missing: string[] = [];
    if (!student.studentName) missing.push('nama siswa');
    if (!student.courseName) missing.push('course');
    if (!Number.isInteger(student.month) || student.month < 1 || student.month > 120) {
        missing.push('bulan');
    }
    if (!isHttpUrl(student.youtubeLink)) missing.push('link YouTube');
    if (!isHttpUrl(student.referralLink)) missing.push('link referral');
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) missing.push('rating');

    if (missing.length > 0) {
        throw new Error(`Baris ${index + 1} tidak valid: ${missing.join(', ')}`);
    }

    return student;
};

const csvCell = (value: unknown): string =>
    `"${String(value ?? '').replace(/"/g, '""')}"`;

/**
 * Download-only monthly feedback generator. This endpoint intentionally has
 * no device/recipient fields and never calls a WhatsApp service.
 */
export const downloadCustomMonthlyFeedback: RequestHandler = async (req, res) => {
    try {
        const rawStudents = req.body?.students;
        const format = req.body?.format === 'pdf' ? 'pdf' : 'zip';

        if (!Array.isArray(rawStudents) || rawStudents.length === 0) {
            return res.status(400).json({ message: 'Minimal satu siswa diperlukan' });
        }

        if (rawStudents.length > MAX_STUDENTS_PER_DOWNLOAD) {
            return res.status(400).json({
                message: `Maksimal ${MAX_STUDENTS_PER_DOWNLOAD} siswa dalam satu proses`,
            });
        }

        const students = rawStudents.map(normalizeCustomFeedbackStudent);

        if (format === 'pdf') {
            if (students.length !== 1) {
                return res.status(400).json({ message: 'Format PDF hanya mendukung satu siswa' });
            }

            const student = students[0];
            const pdf = await generateMonthlyFeedbackPDFWithPuppeteer({
                ...student,
                duration: student.duration || `Bulan ke-${student.month}`,
                level: student.level || '',
                code: student.code || '',
                topicModule: student.topicModule || '',
                result: student.result || '',
                skillsAcquired: student.skillsAcquired || '',
                rating: student.rating || 5,
                reportBy: student.reportBy || 'Tutor',
            });
            const fileName = `Feedback_${safeFilePart(student.studentName)}_${safeFilePart(student.courseName)}_Bulan${student.month}.pdf`;

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            return res.status(200).send(pdf);
        }

        const zip = new JSZip();
        const usedNames = new Map<string, number>();
        const manifestRows: string[] = [
            ['Nama Siswa', 'Course', 'Bulan', 'Status', 'File', 'Keterangan'].map(csvCell).join(','),
        ];
        let successCount = 0;

        for (const student of students) {
            const baseName = `Feedback_${safeFilePart(student.studentName)}_${safeFilePart(student.courseName)}_Bulan${student.month}`;
            const duplicateNumber = (usedNames.get(baseName) || 0) + 1;
            usedNames.set(baseName, duplicateNumber);
            const fileName = `${baseName}${duplicateNumber > 1 ? `_${duplicateNumber}` : ''}.pdf`;

            try {
                const pdf = await generateMonthlyFeedbackPDFWithPuppeteer({
                    ...student,
                    duration: student.duration || `Bulan ke-${student.month}`,
                    level: student.level || '',
                    code: student.code || '',
                    topicModule: student.topicModule || '',
                    result: student.result || '',
                    skillsAcquired: student.skillsAcquired || '',
                    rating: student.rating || 5,
                    reportBy: student.reportBy || 'Tutor',
                });
                zip.file(fileName, pdf);
                successCount += 1;
                manifestRows.push(
                    [student.studentName, student.courseName, student.month, 'Berhasil', fileName, '']
                        .map(csvCell)
                        .join(','),
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Gagal membuat PDF';
                logger.error('[MonthlyFeedbackCustom] PDF generation failed', {
                    student: `${student.studentName.slice(0, 2)}***`,
                    message,
                });
                manifestRows.push(
                    [student.studentName, student.courseName, student.month, 'Gagal', '', message]
                        .map(csvCell)
                        .join(','),
                );
            }
        }

        if (successCount === 0) {
            return res.status(500).json({ message: 'Semua PDF gagal dibuat' });
        }

        zip.file('ringkasan-generate.csv', `\uFEFF${manifestRows.join('\r\n')}`);
        const archive = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 },
        });
        const date = new Date().toISOString().slice(0, 10);
        const zipName = `Feedback_Bulanan_Custom_${date}.zip`;

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
        return res.status(200).send(archive);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Gagal membuat feedback';
        logger.error('[MonthlyFeedbackCustom] Download failed:', message);
        return res.status(400).json({ message });
    }
};

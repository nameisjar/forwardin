import { RequestHandler } from 'express';
import prisma from '../utils/db';
import exp from 'constants';
import { memoryUpload } from '../config/multer';

// reminder
export const createReminder: RequestHandler = async (req, res) => {
    try {
        const { courseName, lesson, message } = req.body;

        // Validasi input
        if (!courseName || !lesson || !message) {
            return res
                .status(400)
                .json({ message: 'All fields (courseName, lesson, message) are required.' });
        }

        // Buat reminder baru
        const reminder = await prisma.courseReminder.create({
            data: {
                courseName,
                lesson,
                message,
            },
        });

        return res.status(201).json({ message: 'Reminder created successfully.', reminder });
    } catch (error: any) {
        // console.error('Error creating reminder:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const getReminders: RequestHandler = async (req, res) => {
    try {
        const reminders = await prisma.courseReminder.findMany();

        return res.status(200).json({ reminders });
    } catch (error: any) {
        // console.error('Error getting reminders:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const getReminderByCourseName: RequestHandler = async (req, res) => {
    try {
        const { courseName } = req.params;

        // Cari reminder berdasarkan courseName dan urutkan dari lesson terkecil
        const reminders = await prisma.courseReminder.findMany({
            where: { courseName },
            orderBy: { lesson: 'asc' },
        });

        return res.status(200).json({ reminders });
    } catch (error: any) {
        // console.error('Error getting reminders:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const updateReminder: RequestHandler = async (req, res) => {
    try {
        const { id } = req.params;
        const { courseName, lesson, message } = req.body;

        // Validasi input
        if (!courseName || !lesson || !message) {
            return res
                .status(400)
                .json({ message: 'All fields (courseName, lesson, message) are required.' });
        }

        // Update reminder
        const reminder = await prisma.courseReminder.update({
            where: { id: id },
            data: {
                courseName,
                lesson,
                message,
            },
        });

        return res.status(200).json({ message: 'Reminder updated successfully.', reminder });
    } catch (error: any) {
        // console.error('Error updating reminder:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const deleteReminders: RequestHandler = async (req, res) => {
    try {
        await prisma.courseReminder.deleteMany();

        return res.status(200).json({ message: 'All reminders deleted successfully.' });
    } catch (error: any) {
        // console.error('Error deleting all reminders:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const deleteReminder: RequestHandler = async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.courseReminder.delete({
            where: { id: id },
        });

        return res.status(200).json({ message: 'Reminder deleted successfully.' });
    } catch (error: any) {
        // console.error('Error deleting reminder:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

// feedback
export const createFeedback: RequestHandler = async (req, res) => {
    try {
        const { courseName, lesson, message } = req.body;

        // Validasi input
        if (!courseName || !lesson || !message) {
            return res
                .status(400)
                .json({ message: 'All fields (courseName, lesson, message) are required.' });
        }

        // Buat feedback baru
        const feedback = await prisma.courseFeedback.create({
            data: {
                courseName,
                lesson,
                message,
            },
        });

        return res.status(201).json({ message: 'Feedback created successfully.', feedback });
    } catch (error: any) {
        // console.error('Error creating feedback:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const getFeedbacks: RequestHandler = async (req, res) => {
    try {
        const feedbacks = await prisma.courseFeedback.findMany();

        return res.status(200).json({ feedbacks });
    } catch (error: any) {
        // console.error('Error getting feedbacks:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const getFeedbackByCourseName: RequestHandler = async (req, res) => {
    try {
        const { courseName } = req.params;

        // Cari feedback berdasarkan courseName dan urutkan dari lesson terkecil
        const feedbacks = await prisma.courseFeedback.findMany({
            where: { courseName },
            orderBy: { lesson: 'asc' },
        });

        return res.status(200).json({ feedbacks });
    } catch (error: any) {
        // console.error('Error getting feedbacks:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const updateFeedback: RequestHandler = async (req, res) => {
    try {
        const { id } = req.params;
        const { courseName, lesson, message } = req.body;

        // Validasi input
        if (!courseName || !lesson || !message) {
            return res
                .status(400)
                .json({ message: 'All fields (courseName, lesson, message) are required.' });
        }

        // Update feedback
        const feedback = await prisma.courseFeedback.update({
            where: { id: id },
            data: {
                courseName,
                lesson,
                message,
            },
        });

        return res.status(200).json({ message: 'Feedback updated successfully.', feedback });
    } catch (error: any) {
        // console.error('Error updating feedback:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const deleteFeedbacks: RequestHandler = async (req, res) => {
    try {
        await prisma.courseFeedback.deleteMany();

        return res.status(200).json({ message: 'All feedbacks deleted successfully.' });
    } catch (error: any) {
        // console.error('Error deleting all feedbacks:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const deleteFeedback: RequestHandler = async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.courseFeedback.delete({
            where: { id: id },
        });

        return res.status(200).json({ message: 'Feedback deleted successfully.' });
    } catch (error: any) {
        // console.error('Error deleting feedback:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const importFeedbacks: RequestHandler = async (req, res) => {
    try {
        memoryUpload.single('file')(req, res, async (err) => {
            if (err) {
                return res.status(500).json({ message: 'Upload failed' });
            }
            if (!req.file) {
                return res.status(400).json({ message: 'No file uploaded' });
            }

            try {
                const replace = String(req.query.replace || 'true').toLowerCase() === 'true';
                const fileName = req.file.originalname.toLowerCase();
                const isXLSX = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
                
                let rows: { courseName: string; lesson: number; message: string }[] = [];

                if (isXLSX) {
                    // Handle XLSX/XLS files using exceljs
                    const ExcelJS = require('exceljs');
                    const workbook = new ExcelJS.Workbook();
                    await workbook.xlsx.load(req.file.buffer);
                    
                    const worksheet = workbook.worksheets[0];
                    if (!worksheet) {
                        return res.status(400).json({ message: 'No worksheet found in Excel file' });
                    }

                    // Check if first row is header
                    const firstRow = worksheet.getRow(1);
                    const firstCellValue = String(firstRow.getCell(1).value || '').toLowerCase();
                    const hasHeader = firstCellValue.includes('course') || firstCellValue.includes('nama');
                    
                    const startRow = hasHeader ? 2 : 1;
                    
                    worksheet.eachRow((row: any, rowNumber: number) => {
                        if (rowNumber < startRow) return;
                        
                        const courseName = String(row.getCell(1).value || '').trim();
                        const lessonValue = row.getCell(2).value;
                        const message = String(row.getCell(3).value || '').trim();
                        
                        // Parse lesson number
                        const lesson = Number(lessonValue);
                        
                        if (courseName && lesson && message) {
                            rows.push({ courseName, lesson, message });
                        }
                    });
                } else {
                    // Handle CSV files (existing logic)
                    const text = req.file.buffer.toString('utf-8');
                    const lines = text
                        .replace(/\r\n/g, '\n')
                        .replace(/\r/g, '\n')
                        .split('\n')
                        .filter((l) => l.trim().length > 0);
                    
                    if (lines.length === 0) {
                        return res.status(400).json({ message: 'Empty file' });
                    }

                    // Basic CSV line parser supporting quoted commas and quotes escaping
                    const parseLine = (line: string, sep = ','): string[] => {
                        const out: string[] = [];
                        let cur = '';
                        let inQuotes = false;
                        for (let i = 0; i < line.length; i++) {
                            const ch = line[i];
                            if (ch === '"') {
                                if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                                    cur += '"';
                                    i++;
                                } else {
                                    inQuotes = !inQuotes;
                                }
                            } else if (ch === sep && !inQuotes) {
                                out.push(cur);
                                cur = '';
                            } else {
                                cur += ch;
                            }
                        }
                        out.push(cur);
                        return out.map((s) => s.trim().replace(/^"|"$/g, ''));
                    };

                    const headerRaw = lines[0];
                    let cols = parseLine(headerRaw, ',');
                    if (cols.length < 3) cols = parseLine(headerRaw, ';');

                    const expected = ['course name', 'lesson', 'message'];
                    const normalized = cols.map((c) => c.toLowerCase());
                    const looksLikeHeader = expected.every((e) => normalized.includes(e));

                    const dataLines = looksLikeHeader ? lines.slice(1) : lines;

                    for (const raw of dataLines) {
                        if (!raw.trim()) continue;
                        let cells = parseLine(raw, ',');
                        if (cells.length < 3) cells = parseLine(raw, ';');
                        if (cells.length < 3) continue;
                        const [courseName, lessonStr, message] = [
                            cells[0] || '',
                            cells[1] || '',
                            cells.slice(2).join(',') || '',
                        ];
                        const lesson = Number(String(lessonStr).trim());
                        if (!courseName || !lesson || !message) continue;
                        rows.push({ courseName: courseName.trim(), lesson, message: message.trim() });
                    }
                }

                if (rows.length === 0) {
                    return res.status(400).json({ message: 'No valid rows found' });
                }

                if (replace) {
                    await prisma.courseFeedback.deleteMany();
                }

                const batchSize = 500;
                let inserted = 0;
                for (let i = 0; i < rows.length; i += batchSize) {
                    const chunk = rows.slice(i, i + batchSize);
                    const result = await prisma.courseFeedback.createMany({ data: chunk });
                    inserted += result.count;
                }

                return res
                    .status(200)
                    .json({ message: 'Import completed', inserted, replaced: replace });
            } catch (e: any) {
                // console.error('Error processing file:', e);
                return res.status(500).json({ message: 'Failed to process file', error: e.message });
            }
        });
    } catch (error: any) {
        // console.error('Error in importFeedbacks:', error);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
};

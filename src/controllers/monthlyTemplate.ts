import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';

// Get all monthly templates
export const getMonthlyTemplates: RequestHandler = async (req, res) => {
    try {
        const templates = await prisma.monthlyTemplate.findMany({
            orderBy: [
                { courseName: 'asc' },
                { month: 'asc' }
            ]
        });
        
        res.status(200).json({ templates });
    } catch (error) {
        logger.error('Error fetching monthly templates:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Get monthly templates by course name
export const getMonthlyTemplatesByCourse: RequestHandler = async (req, res) => {
    try {
        const { courseName } = req.params;
        
        const templates = await prisma.monthlyTemplate.findMany({
            where: {
                courseName: courseName
            },
            orderBy: {
                month: 'asc'
            }
        });
        
        res.status(200).json({ templates });
    } catch (error) {
        logger.error('Error fetching templates by course:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Create a single monthly template
export const createMonthlyTemplate: RequestHandler = async (req, res) => {
    try {
        const { courseName, code, month, level, topicModule, result, skillsAcquired } = req.body;

        // Validation
        if (!courseName || !code || !month) {
            return res.status(400).json({ 
                message: 'courseName, code, and month are required' 
            });
        }

        // Check if template with same courseName and month already exists
        const existing = await prisma.monthlyTemplate.findUnique({
            where: {
                courseName_month: {
                    courseName,
                    month: parseInt(month)
                }
            }
        });

        if (existing) {
            return res.status(400).json({ 
                message: `Template untuk ${courseName} bulan ${month} sudah ada` 
            });
        }

        const template = await prisma.monthlyTemplate.create({
            data: {
                courseName,
                code,
                month: parseInt(month),
                level: level || '',
                topicModule: topicModule || '',
                result: result || '',
                skillsAcquired: skillsAcquired || ''
            }
        });

        res.status(201).json({ 
            message: 'Template berhasil ditambahkan',
            template 
        });
    } catch (error) {
        logger.error('Error creating template:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Update a monthly template
export const updateMonthlyTemplate: RequestHandler = async (req, res) => {
    try {
        const { id } = req.params;
        const { courseName, code, month, level, topicModule, result, skillsAcquired } = req.body;

        // Check if template exists
        const existing = await prisma.monthlyTemplate.findUnique({
            where: { id }
        });

        if (!existing) {
            return res.status(404).json({ message: 'Template tidak ditemukan' });
        }

        // If courseName or month is being changed, check for duplicates
        if ((courseName && courseName !== existing.courseName) || 
            (month && parseInt(month) !== existing.month)) {
            const duplicate = await prisma.monthlyTemplate.findUnique({
                where: {
                    courseName_month: {
                        courseName: courseName || existing.courseName,
                        month: parseInt(month) || existing.month
                    }
                }
            });

            if (duplicate && duplicate.id !== id) {
                return res.status(400).json({ 
                    message: `Template untuk ${courseName || existing.courseName} bulan ${month || existing.month} sudah ada` 
                });
            }
        }

        const template = await prisma.monthlyTemplate.update({
            where: { id },
            data: {
                courseName: courseName || existing.courseName,
                code: code || existing.code,
                month: month ? parseInt(month) : existing.month,
                level: level !== undefined ? level : existing.level,
                topicModule: topicModule !== undefined ? topicModule : existing.topicModule,
                result: result !== undefined ? result : existing.result,
                skillsAcquired: skillsAcquired !== undefined ? skillsAcquired : existing.skillsAcquired
            }
        });

        res.status(200).json({ 
            message: 'Template berhasil diperbarui',
            template 
        });
    } catch (error) {
        logger.error('Error updating template:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Import monthly templates from Excel (bulk create)
export const importMonthlyTemplates: RequestHandler = async (req, res) => {
    try {
        const { templates } = req.body;

        if (!Array.isArray(templates) || templates.length === 0) {
            return res.status(400).json({ message: 'Invalid templates data' });
        }

        // Log untuk debugging
        // console.log('📥 Received templates:', JSON.stringify(templates.slice(0, 1), null, 2));

        // Transform Excel data to match database schema
        // Frontend mengirim: courseName, code, month, level, topicModule, result, skillsAcquired
        const transformedTemplates = templates.map(template => {
            const courseName = template.courseName || '';
            const code = template.code || '';
            const month = parseInt(template.month) || 0;
            const level = template.level || '';
            const topicModule = template.topicModule || '';
            const result = template.result || '';
            const skillsAcquired = template.skillsAcquired || '';

            return {
                courseName,
                code,
                month,
                level,
                topicModule,
                result,
                skillsAcquired
            };
        });

        // Log transformed data
        // console.log('🔄 Transformed template:', JSON.stringify(transformedTemplates.slice(0, 1), null, 2));

        // Validate each template
        const invalidTemplates = transformedTemplates.filter(t => 
            !t.courseName || !t.code || !t.month || t.month === 0
        );

        if (invalidTemplates.length > 0) {
            return res.status(400).json({ 
                message: 'Each template must have courseName, code, and month',
                invalidCount: invalidTemplates.length,
                hint: 'Please check your Excel file has columns: Nama Course, Code, Bulan Ke, Level, Topik Modul, Hasil, Keahlian yang Didapatkan'
            });
        }

        // Bulk create with upsert to avoid duplicates
        const promises = transformedTemplates.map(template => 
            prisma.monthlyTemplate.upsert({
                where: {
                    courseName_month: {
                        courseName: template.courseName,
                        month: template.month
                    }
                },
                update: {
                    code: template.code,
                    level: template.level,
                    topicModule: template.topicModule,
                    result: template.result,
                    skillsAcquired: template.skillsAcquired
                },
                create: {
                    courseName: template.courseName,
                    code: template.code,
                    month: template.month,
                    level: template.level,
                    topicModule: template.topicModule,
                    result: template.result,
                    skillsAcquired: template.skillsAcquired
                }
            })
        );

        await Promise.all(promises);

        res.status(201).json({ 
            message: 'Templates imported successfully',
            count: transformedTemplates.length 
        });
    } catch (error) {
        logger.error('Error importing templates:', error);
        res.status(500).json({ 
            message: 'Internal server error',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

// Bulk create monthly templates
export const bulkCreateMonthlyTemplates: RequestHandler = async (req, res) => {
    try {
        const { templates } = req.body;

        if (!Array.isArray(templates) || templates.length === 0) {
            return res.status(400).json({ message: 'Invalid templates data' });
        }

        // Use createMany for bulk insert
        const result = await prisma.monthlyTemplate.createMany({
            data: templates.map(t => ({
                courseName: t.courseName,
                code: t.code,
                month: t.month,
                level: t.level || '',
                topicModule: t.topicModule || '',
                result: t.result || '',
                skillsAcquired: t.skillsAcquired || ''
            })),
            skipDuplicates: true // Skip duplicates based on unique constraint
        });

        res.status(201).json({ 
            message: 'Templates created successfully',
            count: result.count 
        });
    } catch (error) {
        logger.error('Error bulk creating templates:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Delete a monthly template
export const deleteMonthlyTemplate: RequestHandler = async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.monthlyTemplate.delete({
            where: { id }
        });

        res.status(200).json({ message: 'Template deleted successfully' });
    } catch (error) {
        logger.error('Error deleting template:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

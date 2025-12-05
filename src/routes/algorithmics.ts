import express from 'express';
import {
    getMonthlyTemplates,
    getMonthlyTemplatesByCourse,
    createMonthlyTemplate,
    updateMonthlyTemplate,
    importMonthlyTemplates,
    bulkCreateMonthlyTemplates,
    deleteMonthlyTemplate
} from '../controllers/monthlyTemplate';
import { sendMonthlyFeedback, getMonthlyFeedbackLogs } from '../controllers/monthlyFeedback';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// Monthly Templates Routes
router.get('/monthly-templates', authMiddleware, getMonthlyTemplates);
router.get('/monthly-templates/:courseName', authMiddleware, getMonthlyTemplatesByCourse);
router.post('/monthly-templates', authMiddleware, createMonthlyTemplate);
router.put('/monthly-templates/:id', authMiddleware, updateMonthlyTemplate);
router.post('/monthly-templates/import', authMiddleware, importMonthlyTemplates);
router.post('/monthly-templates/bulk', authMiddleware, bulkCreateMonthlyTemplates);
router.delete('/monthly-templates/:id', authMiddleware, deleteMonthlyTemplate);

// Monthly Feedback Routes
router.post('/monthly-feedback/send', authMiddleware, sendMonthlyFeedback);
router.get('/monthly-feedback/logs', authMiddleware, getMonthlyFeedbackLogs);

export default router;

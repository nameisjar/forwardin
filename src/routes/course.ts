import { Router } from 'express';
import * as controller from '../controllers/course';

const router = Router();

router.post('/reminder', controller.createReminder);
router.get('/reminders', controller.getReminders);
router.get('/reminder/:courseName', controller.getReminderByCourseName);
router.put('/reminder/:id', controller.updateReminder);
router.delete('/reminder/:id', controller.deleteReminder);
router.delete('/reminders', controller.deleteReminders);
router.post('/feedback', controller.createFeedback);
router.get('/feedbacks', controller.getFeedbacks);
router.get('/feedback/:courseName', controller.getFeedbackByCourseName);
router.put('/feedback/:id', controller.updateFeedback);
router.delete('/feedbacks', controller.deleteFeedbacks);
router.delete('/feedback/:id', controller.deleteFeedback);

export default router;

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import * as tutor from '../controllers/tutor';

const router = Router();

const ADMIN_ID = Number(process.env.ADMIN_ID);
const SUPER_ADMIN_ID = Number(process.env.SUPER_ADMIN_ID);
const CS_ID = Number(process.env.CS_ID);

function isAdmin(req: Request, res: Response, next: NextFunction) {
    const roleId = req.privilege?.pkId;
    if (roleId === ADMIN_ID || roleId === SUPER_ADMIN_ID) return next();
    return res.status(403).json({ message: 'Admin only' });
}

function isTutor(req: Request, res: Response, next: NextFunction) {
    const roleId = req.privilege?.pkId;
    if (roleId === CS_ID) return next();
    if (roleId === ADMIN_ID || roleId === SUPER_ADMIN_ID) return next();
    return res.status(403).json({ message: 'Tutor only' });
}

router.get('/me', authMiddleware, tutor.getMe);

// Admin manages tutors
router.post('/', authMiddleware, isAdmin, tutor.createTutor);
router.get('/', authMiddleware, isAdmin, tutor.listTutors);
router.get('/messages/all', authMiddleware, isAdmin, tutor.listOutgoingMessagesAll);
router.delete('/messages/all', authMiddleware, isAdmin, tutor.deleteOutgoingMessagesAll);

// Tutor flows without subscription involvement
router.post('/devices', authMiddleware, isTutor, tutor.createDeviceNoSubscription);
router.get('/messages', authMiddleware, isTutor, tutor.listOutgoingMessages);
router.post('/sessions/create-sse', authMiddleware, isTutor, tutor.createSSE);
router.get('/groups', authMiddleware, isTutor, tutor.listGroups);

export default router;

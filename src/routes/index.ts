import { Router, Request, Response } from 'express';
import authRoutes from './auth';
import deviceRoutes from './devices';
import userRoutes from './users';
import sessionRoutes from './sessions';
import contactRoutes from './contacts';
import groupRoutes from './groups';
import messageRoutes from './messages';
import paymentRoutes from './payments';
import subscriptionPlanRoutes from './subscriptionPlans';
import autoReplyRoutes from './autoReplies';
import broadcastRoutes from './broadcasts';
import campaignRoutes from './campaigns';
import authMiddleware from '../middleware/auth';

const router = Router();

router.get('/', (req: Request, res: Response) => {
    res.send('Forwardin Jaya Jaya Jaya!');
});

router.use('/auth', authRoutes);
router.use('/sessions', authMiddleware, sessionRoutes);
router.use('/devices', authMiddleware, deviceRoutes);
router.use('/users', authMiddleware, userRoutes);
router.use('/contacts', authMiddleware, contactRoutes);
router.use('/groups', authMiddleware, groupRoutes);
router.use('/messages', authMiddleware, messageRoutes);
router.use('/payment', paymentRoutes);
router.use('/subscriptions', authMiddleware, subscriptionPlanRoutes);
router.use('/auto-replies', authMiddleware, autoReplyRoutes);
router.use('/broadcasts', authMiddleware, broadcastRoutes);
router.use('/campaigns', authMiddleware, campaignRoutes);

export default router;

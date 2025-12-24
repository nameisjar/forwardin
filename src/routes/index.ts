import express, { Router, Request, Response } from 'express';
import authRoutes from './auth';
import deviceRoutes from './devices';
import userRoutes from './users';
import sessionRoutes from './sessions';
import contactRoutes from './contacts';
import groupRoutes from './groups';
import templateRoutes from './templates';
import messageRoutes from './messages';
import paymentRoutes from './payments';
import autoReplyRoutes from './autoReplies';
import broadcastRoutes from './broadcasts';
import campaignRoutes from './campaigns';
import orderRoutes from './orders';
import menuRoutes from './menus';
import subsPlanRoutes from './subscriptionPlans';
import privilegeRoutes from './privileges';
import customerServiceRoutes from './customerServices';
import businessHourRoutes from './businessHours';
import analyticsRoutes from './analytics';
import { authMiddleware, apiKeyDevice, deviceAccessTokenRequired, deviceTokenOnly } from '../middleware/auth';
import superAdminRoutes from './superAdmin';
import deviceApi from './deviceApi';
import courseRoutes from './course';
import tutorsRoutes from './tutors';
import whatsappGroupRoutes from './whatsappGroups';
import algorithmicsRoutes from './algorithmics';
import deviceApiExternal from './deviceApiExternal';
import healthRoutes from './health';
import codeSnippetRoutes from './codeSnippets';
import { getSnippetByShareToken } from '../controllers/codeSnippet';

const router = Router();

router.get('/', (req: Request, res: Response) => {
    res.send('Forwardin Jaya Jaya Jaya!');
});

// 🔧 Health check endpoints (no auth for basic health, auth for detailed stats)
router.use('/health', healthRoutes);

router.use('/auth', authRoutes);
router.use('/sessions', authMiddleware, sessionRoutes);
router.use('/devices', authMiddleware, deviceRoutes);
router.use('/users', authMiddleware, userRoutes);
router.use('/contacts', authMiddleware, contactRoutes);
router.use('/groups', authMiddleware, groupRoutes);
router.use('/templates', authMiddleware, templateRoutes);
router.use('/messages', authMiddleware, messageRoutes);
router.use('/payment', paymentRoutes);
router.use('/business-hours', authMiddleware, businessHourRoutes);
router.use('/auto-replies', authMiddleware, autoReplyRoutes);
router.use('/broadcasts', authMiddleware, broadcastRoutes);
router.use('/campaigns', authMiddleware, campaignRoutes);
router.use('/orders', authMiddleware, orderRoutes);
router.use('/menus', authMiddleware, menuRoutes);
router.use('/privileges', authMiddleware, privilegeRoutes);
router.use('/subscription-plans', authMiddleware, subsPlanRoutes);
router.use('/customer-services', customerServiceRoutes);
router.use('/analytics', authMiddleware, analyticsRoutes);
router.use('/super-admin', superAdminRoutes);
router.use('/api', deviceTokenOnly, deviceApi);
// Reserve for future third-party usage
router.use('/api-external', apiKeyDevice, deviceApiExternal);
router.use('/algorithmics', authMiddleware, algorithmicsRoutes);
router.use('/course', authMiddleware, courseRoutes); // 🔥 Tambahkan ini!
router.use('/tutors', tutorsRoutes);
router.use('/whatsapp-groups', whatsappGroupRoutes);
router.use('/code-snippets', authMiddleware, codeSnippetRoutes);
// Public route for viewing shared snippets (no auth required)
router.get('/snippets/share/:token', getSnippetByShareToken);
router.use('/media', express.static('media'));

export default router;

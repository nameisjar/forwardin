import { Router } from 'express';
import authRoutes from './auth';
import deviceRoutes from './devices';
import userRoutes from './users';
import sessionRoutes from './sessions';
import { apiKey, authenticateUser } from '../middleware/auth';

const router = Router();
router.use('/auth', authRoutes);
router.use('/sessions', authenticateUser, apiKey, sessionRoutes);
router.use('/devices', authenticateUser, apiKey, deviceRoutes);
router.use('/users', authenticateUser, apiKey, userRoutes);

export default router;

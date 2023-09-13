import { Router } from 'express';
import authRoutes from './auth';
import deviceRoutes from './devices';
import { apiKey, authenticateUser } from '../middleware/auth';

const router = Router();
router.use('/auth', authRoutes);
router.use('/devices', authenticateUser, apiKey, deviceRoutes);

export default router;

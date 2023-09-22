import { Router } from 'express';
import authRoutes from './auth';
import deviceRoutes from './devices';
import userRoutes from './users';
import sessionRoutes from './sessions';
import authMiddleware from '../middleware/auth';

const router = Router();
router.use('/auth', authRoutes);
router.use('/sessions', authMiddleware, sessionRoutes);
router.use('/devices', authMiddleware, deviceRoutes);
router.use('/users', authMiddleware, userRoutes);

export default router;

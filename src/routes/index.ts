import { Router, Request, Response } from 'express';
import authRoutes from './auth';
import deviceRoutes from './devices';
import userRoutes from './users';
import sessionRoutes from './sessions';
import contactRoutes from './contacts';
import groupRoutes from './groups';
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

export default router;

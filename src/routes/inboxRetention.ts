import { NextFunction, Request, Response, Router } from 'express';
import * as controller from '../controllers/inboxRetention';
import { isDeviceAdmin } from '../utils/deviceAccess';

const router = Router();

function adminOnly(req: Request, res: Response, next: NextFunction) {
    if (isDeviceAdmin(req.privilege?.pkId)) return next();
    return res.status(403).json({ message: 'Access denied: Admin only' });
}

router.use(adminOnly);
router.get('/', controller.getRetentionConfiguration);
router.put('/', controller.updateRetentionConfiguration);
router.post('/cleanup', controller.cleanupInboxNow);

export default router;

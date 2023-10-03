import { Router } from 'express';
import * as controller from '../controllers/session';

const router = Router();

router.post('/create', controller.createSession);
router.delete('/:sessionId/delete', controller.deleteSession);
router.get('/:sessionId/status', controller.getSessionStatus);

export default router;

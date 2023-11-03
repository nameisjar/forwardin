import { Router } from 'express';
import * as controller from '../controllers/session';
import { checkPrivilege } from '../middleware/auth';

const router = Router();

router.use(checkPrivilege('session'));
router.post('/create', controller.createSession);
router.post('/create-sse', controller.createSSE);
router.delete('/:sessionId/delete', controller.deleteSession);
router.get('/:sessionId/status', controller.getSessionStatus);
router.get('/:deviceApiKey/', controller.getSessionsByDeviceApiKey);
router.get('/', controller.getSessions);

export default router;

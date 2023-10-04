import { Router } from 'express';
import * as controller from '../controllers/message';

const router = Router();

router.post('/:sessionId/send', controller.sendSingle);
router.post('/:sessionId/send/bulk', controller.sendBulk);
router.post('/:sessionId/send/image', controller.sendImage);
router.post('/:sessionId/send/bulk-image', controller.sendImageToMultiple);
router.post('/:sessionId/send/button', controller.sendButton);
router.get('/:sessionId', controller.getMessages);

export default router;

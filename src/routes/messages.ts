import { Router } from 'express';
import * as controller from '../controllers/message';

const router = Router();

router.post('/:sessionId/send', controller.sendMessages);
router.post('/:sessionId/send/image', controller.sendImageMessages);
router.post('/:sessionId/send/button', controller.sendButton);
router.get('/:sessionId', controller.getMessages);
router.get('/:sessionId/incoming', controller.getIncomingMessages);
router.get('/:sessionId/outgoing', controller.getOutgoingMessages);

export default router;

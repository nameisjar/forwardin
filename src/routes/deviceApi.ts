import { Router } from 'express';
import * as controller from '../controllers/deviceApi';

const router = Router();

router.post('/messages/send', controller.sendMessages);
router.post('/messages/send/image', controller.sendImageMessages);
router.post('/messages/send/doc', controller.sendDocumentMessages);
router.post('/messages/send/button', controller.sendButton);
router.get('/messages', controller.getConversationMessages);
router.get('/messages/incoming', controller.getIncomingMessages);
router.get('/messages/outgoing', controller.getOutgoingMessages);
router.get('/messages/messenger-list', controller.getMessengerList);

export default router;

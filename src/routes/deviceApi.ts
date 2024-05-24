import { Router } from 'express';
import * as controller from '../controllers/deviceApi';

const router = Router();

router.post('/messages/send', controller.sendMessages);
router.post('/messages/send/image', controller.sendImageMessages);
router.post('/messages/send/doc', controller.sendDocumentMessages);
router.post('/messages/send/audio', controller.sendAudioMessages);
router.post('/messages/send/video', controller.sendVideoMessages);
router.post('/messages/send/button', controller.sendButton);
router.post('/messages/broadcasts', controller.createBroadcast);
router.post('/messages/auto-replies', controller.createAutoReplies);
router.get('/messages', controller.getConversationMessages);
router.get('/messages/incoming', controller.getIncomingMessages);
router.get('/messages/outgoing', controller.getOutgoingMessages);
router.get('/messages/messenger-list', controller.getMessengerList);
router.get('/messages/broadcasts', controller.getBroadcasts);
router.delete('/messages/broadcasts', controller.deleteAllBroadcasts);
router.delete('/messages', controller.deleteAllMessages);

export default router;

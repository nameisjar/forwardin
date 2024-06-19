import { Router } from 'express';
import * as controller from '../controllers/message';
import { checkPrivilege } from '../middleware/auth';

const router = Router();

// router.use(checkPrivilege('message'));
router.post('/:sessionId/send', controller.sendMessages);
router.post('/:sessionId/send/image', controller.sendImageMessages);
router.post('/:sessionId/send/doc', controller.sendDocumentMessages);
router.post('/:sessionId/send/button', controller.sendButton);
router.get('/:sessionId', controller.getConversationMessages);
router.get('/:sessionId/export-zip', controller.exportMessagesToZip);
router.get('/:sessionId/incoming', controller.getIncomingMessages);
router.get('/:sessionId/outgoing', controller.getOutgoingMessages);
router.get('/:sessionId/messenger-list', controller.getMessengerList);
router.get('/:sessionId/outgoing-status/:messageId', controller.getStatusOutgoingMessagesById);

export default router;

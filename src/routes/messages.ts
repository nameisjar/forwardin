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
router.delete('/:sessionId/everyone', controller.deleteMessagesForEveryone);
router.delete('/:sessionId/me', controller.deleteMessagesForMe);
router.put('/:sessionId/edit', controller.updateMessage);
router.post('/:sessionId/mute', controller.muteChat);
router.post('/:sessionId/pin', controller.pinChat);
router.post('/:sessionId/star', controller.starMessage);
router.post('/:sessionId/status', controller.updateProfileStatus);
router.post('/:sessionId/profile-name', controller.updateProfileName);
router.get('/:sessionId/get-profile', controller.getProfilePictureUrl);

export default router;

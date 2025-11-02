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
router.post('/messages/broadcasts/scheduled', controller.createBroadcastScheduled);
router.post('/messages/broadcasts/reminder', controller.createBroadcastReminder);
router.post('/messages/broadcasts/feedback', controller.createBroadcastFeedback);
// router.post('/messages/broadcasts/recurring', controller.createBroadcastRecurring);  //testing
router.post('/messages/auto-replies', controller.createAutoReplies);
router.get('/messages', controller.getConversationMessages);
router.get('/messages/incoming', controller.getIncomingMessages);
router.get('/messages/outgoing', controller.getOutgoingMessages);
router.get('/messages/messenger-list', controller.getMessengerList);
router.get('/messages/outgoing-status/:messageId', controller.getStatusOutgoingMessagesById);
router.get('/messages/get-profile', controller.getProfilePictureUrl);
router.get('/messages/business-profile', controller.getBusinessProfile);
router.get('/messages/export-zip/', controller.exportMessagesToZip);
router.get('/messages/broadcasts', controller.getBroadcasts);
router.get('/messages/broadcasts-name', controller.getBroadcastsName);
router.delete('/messages/broadcasts', controller.deleteAllBroadcasts);
router.delete('/messages/broadcast-name', controller.deleteBroadcastsByName);
router.delete('/messages', controller.deleteAllMessages);
router.delete('/messages/everyone', controller.deleteMessagesForEveryone);
router.delete('/messages/me', controller.deleteMessagesForMe);
router.put('/messages/edit', controller.updateMessage);
router.post('/messages/mute', controller.muteChat);
router.post('/messages/pin', controller.pinChat);
router.post('/messages/star', controller.starMessage);
router.post('/messages/status', controller.updateProfileStatus);
router.post('/messages/profile-name', controller.updateProfileName);
router.post('/messages/profile-picture', controller.updateProfilePicture);
router.delete('/messages/profile-picture', controller.removeProfilePicture);
router.post('/messages/block-unblock', controller.updateBlockStatus);
router.get('/messages/get-groups', controller.getGroups);
router.get('/messages/get-groups/detail', controller.getGroupsWithFullId);
router.get('/messages/get-groups/search', controller.searchGroups);
router.get('/messages/get-groups/:groupId', controller.getGroupById);
router.get('/messages/get-groups/:groupId/members', controller.getGroupMembers);
router.get('/messages/get-groups/export/csv', controller.exportGroupsToCSV);

export default router;

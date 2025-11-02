import { Router } from 'express';
import * as controller from '../controllers/message';
import { checkPrivilege } from '../middleware/auth';
// add controllers and middlewares for broadcasts/auto-replies alias endpoints
import * as broadcastController from '../controllers/broadcast';
import * as autoReplyController from '../controllers/autoReply';
import {
    checkSubscriptionQuota,
    isBroadcastQuotaAvailable,
    isAutoReplyQuotaAvailable,
} from '../middleware/subscription';

const router = Router();

router.use(checkPrivilege('message'));
router.post('/:sessionId/send', controller.sendMessages);
router.post('/:sessionId/send/image', controller.sendImageMessages);
router.post('/:sessionId/send/doc', controller.sendDocumentMessages);
// add parity send endpoints
router.post('/:sessionId/send/audio', controller.sendAudioMessages);
router.post('/:sessionId/send/video', controller.sendVideoMessages);
router.post('/:sessionId/send/button', controller.sendButton);
router.get('/:sessionId', controller.getConversationMessages);
router.get('/:sessionId/export-zip', controller.exportMessagesToZip);
router.get('/:sessionId/incoming', controller.getIncomingMessages);
router.get('/:sessionId/outgoing', controller.getOutgoingMessages);
router.get('/:sessionId/messenger-list', controller.getMessengerList);
router.get('/:sessionId/outgoing-status/:messageId', controller.getStatusOutgoingMessagesById);
router.get('/:sessionId/get-profile', controller.getProfilePictureUrl);
router.get('/:sessionId/business-profile', controller.getBusinessProfile);
// group-related endpoints parity with deviceApi
router.get('/:sessionId/get-groups', controller.getGroups);
router.get('/:sessionId/get-groups/detail', controller.getGroupsWithFullId);
router.get('/:sessionId/get-groups/search', controller.searchGroups);
router.get('/:sessionId/get-groups/:groupId', controller.getGroupById);
router.get('/:sessionId/get-groups/:groupId/members', controller.getGroupMembers);
router.get('/:sessionId/get-groups/export/csv', controller.exportGroupsToCSV);

// alias endpoints for broadcasts and auto-replies similar to deviceApi
router.post(
    '/:sessionId/broadcasts',
    checkSubscriptionQuota,
    isBroadcastQuotaAvailable,
    broadcastController.createBroadcast,
);
router.post(
    '/:sessionId/broadcasts/scheduled',
    checkSubscriptionQuota,
    isBroadcastQuotaAvailable,
    broadcastController.createBroadcastScheduled,
);
router.post(
    '/:sessionId/broadcasts/reminder',
    checkSubscriptionQuota,
    isBroadcastQuotaAvailable,
    broadcastController.createBroadcastReminder,
);
router.post(
    '/:sessionId/broadcasts/feedback',
    checkSubscriptionQuota,
    isBroadcastQuotaAvailable,
    broadcastController.createBroadcastFeedback,
);
router.post(
    '/:sessionId/auto-replies',
    checkSubscriptionQuota,
    isAutoReplyQuotaAvailable,
    autoReplyController.createAutoReplies,
);

router.delete('/:sessionId/everyone', controller.deleteMessagesForEveryone);
router.delete('/:sessionId/me', controller.deleteMessagesForMe);
router.put('/:sessionId/edit', controller.updateMessage);
router.post('/:sessionId/mute', controller.muteChat);
router.post('/:sessionId/pin', controller.pinChat);
router.post('/:sessionId/star', controller.starMessage);
router.post('/:sessionId/status', controller.updateProfileStatus);
router.post('/:sessionId/profile-name', controller.updateProfileName);
router.post('/:sessionId/profile-picture', controller.updateProfilePicture);
router.delete('/:sessionId/profile-picture', controller.removeProfilePicture);
router.post('/:sessionId/block-unblock', controller.updateBlockStatus);

export default router;

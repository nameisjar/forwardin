import { Router } from 'express';
import * as controller from '../controllers/device';
import * as assignmentController from '../controllers/deviceAssignment';
import { checkSubscriptionQuota, isDeviceQuotaAvailable } from '../middleware/subscription';

const router = Router();

router.get('/', controller.getDevices);
router.get('/labels', controller.getDeviceLabels);
router.get('/assignment-users', assignmentController.getAssignmentUsers);
router.post('/create', checkSubscriptionQuota, isDeviceQuotaAvailable, controller.createDevice);
router.get('/:deviceId/assignments', assignmentController.getDeviceAssignments);
router.post('/:deviceId/assignments', assignmentController.assignDevice);
router.delete('/:deviceId/assignments/:userId', assignmentController.revokeDeviceAssignment);
router.get('/:deviceId', controller.getDevice);
router.get('/api-key/:deviceId', controller.generateApiKeyDevice);
router.put('/:deviceId', controller.updateDevice);
router.delete('/', controller.deleteDevices);
router.post('/:deviceId/logout', controller.logoutDevice);
router.post('/:deviceId/access-token', controller.issueDeviceAccessToken);

// Inbox - incoming messages (persists across session reconnects)
router.get('/:deviceId/inbox', controller.getDeviceInbox);
router.get('/:deviceId/inbox/timeline', controller.getDeviceConversationTimeline);
router.get('/:deviceId/inbox/reactions', controller.getInboxConversationReactions);
router.delete('/:deviceId/inbox', controller.deleteAllInbox);
router.delete('/:deviceId/inbox/conversation', controller.deleteConversation);
router.put('/:deviceId/inbox/conversation/read', controller.markConversationAsRead);

// Outbox - outgoing messages sent from this device
router.get('/:deviceId/outbox/conversations', controller.getDeviceOutboxConversations);
router.get('/:deviceId/outbox', controller.getDeviceOutbox);

// Health monitoring endpoints
router.get('/:id/health', controller.getDeviceHealthStatus);
router.get('/:id/signals', controller.getDeviceSignals);
router.post('/:id/pause', controller.pauseDeviceManually);
router.post('/:id/resume', controller.resumeDeviceManually);

export default router;

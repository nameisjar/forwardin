import { Router } from 'express';
import * as controller from '../controllers/device';
import { checkSubscriptionQuota, isDeviceQuotaAvailable } from '../middleware/subscription';

const router = Router();

router.get('/', controller.getDevices);
router.get('/labels', controller.getDeviceLabels);
router.post('/create', checkSubscriptionQuota, isDeviceQuotaAvailable, controller.createDevice);
router.get('/:deviceId', controller.getDevice);
router.get('/api-key/:deviceId', controller.generateApiKeyDevice);
router.put('/:deviceId', controller.updateDevice);
router.delete('/', controller.deleteDevices);
router.post('/:deviceId/access-token', controller.issueDeviceAccessToken);

// Inbox - incoming messages (persists across session reconnects)
router.get('/:deviceId/inbox', controller.getDeviceInbox);
router.delete('/:deviceId/inbox', controller.deleteAllInbox);
router.delete('/:deviceId/inbox/conversation', controller.deleteConversation);

// Outbox - outgoing messages sent from this device
router.get('/:deviceId/outbox', controller.getDeviceOutbox);

// Health monitoring endpoints
router.get('/:id/health', controller.getDeviceHealthStatus);
router.get('/:id/signals', controller.getDeviceSignals);
router.post('/:id/pause', controller.pauseDeviceManually);
router.post('/:id/resume', controller.resumeDeviceManually);

export default router;

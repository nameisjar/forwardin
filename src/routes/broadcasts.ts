import express from 'express';
import * as controller from '../controllers/broadcast';

const router = express.Router();

// READ operations - used by frontend for viewing/managing broadcasts
router.get('/', controller.getAllBroadcasts);
router.get('/groups', controller.getBroadcastNameGroups);
router.get('/summary', controller.getBroadcastsSummary);
router.get('/:broadcastId', controller.getBroadcast);
router.get('/:broadcastId/outgoing', controller.getOutgoingBroadcasts);
router.get('/:broadcastId/replies', controller.getBrodcastReplies);

// UPDATE operations
router.put('/:id', controller.updateBroadcast);
router.patch('/:id/status', controller.updateBroadcastStatus);

// DELETE operations
router.delete('/bulk', controller.bulkDeleteBroadcasts);
router.delete('/by-name', controller.deleteBroadcastsByName);
router.delete('/', controller.deleteBroadcasts);

// NOTE: CREATE operations (POST) are handled by deviceApi routes:
// - POST /device/messages/broadcasts
// - POST /device/messages/broadcasts/scheduled
// - POST /device/messages/broadcasts/reminder
// - POST /device/messages/broadcasts/feedback

export default router;

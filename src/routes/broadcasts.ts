import express from 'express';
import * as controller from '../controllers/broadcast';

const router = express.Router();

router.post('/', controller.createBroadcast);
router.get('/', controller.getAllBroadcasts);
router.get('/:broadcastId', controller.getBroadcast);
router.get('/:broadcastId/outgoing', controller.getOutgoingBroadcasts);
router.get('/:broadcastId/replies', controller.getBrodcastReplies);
router.put('/:id', controller.updateBroadcast);
router.patch('/:id/status', controller.updateBroadcastStatus);
router.delete('/', controller.deleteBroadcasts);

export default router;

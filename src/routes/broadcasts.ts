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
router.delete('/bulk', controller.bulkDeleteBroadcasts);
router.delete('/by-name', controller.deleteBroadcastsByName); // Route baru untuk hapus berdasarkan nama (hanya yang belum terkirim)
router.delete('/', controller.deleteBroadcasts);

// Added alias routes for reminder and scheduled broadcasts to avoid 404 in UI menus
router.post('/reminder', controller.createBroadcastReminder);
router.post('/scheduled', controller.createBroadcastScheduled);
router.post('/feedback', controller.createBroadcastFeedback);

export default router;

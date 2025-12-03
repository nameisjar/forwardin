import { Router } from 'express';
import {
  getActiveGroups,
  getAllGroups,
  searchGroups,
  updateGroupStatus,
  deleteGroup,
  syncGroups,
  joinGroup,
  leaveGroup,
} from '../controllers/whatsappGroup';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Get active groups for a device
router.get('/device/:deviceId/active', authMiddleware, getActiveGroups);

// Get all groups for a device (active and inactive)
router.get('/device/:deviceId/all', authMiddleware, getAllGroups);

// Search groups by name
router.get('/device/:deviceId/search', authMiddleware, searchGroups);

// Update group status (activate/deactivate)
router.put('/device/:deviceId/group/:groupId/status', authMiddleware, updateGroupStatus);

// Delete group permanently
router.delete('/device/:deviceId/group/:groupId', authMiddleware, deleteGroup);

// Sync groups manually
router.post('/device/:deviceId/sync', authMiddleware, syncGroups);

// Join group via invite link
router.post('/device/:deviceId/join', authMiddleware, joinGroup);

// Leave group
router.post('/device/:deviceId/leave/:groupJid', authMiddleware, leaveGroup);

export default router;
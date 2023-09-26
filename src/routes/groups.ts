import { Router } from 'express';
import * as controller from '../controllers/group';

const router = Router();
router.get('/', controller.getGroups);
router.get('/:groupId', controller.getGroup);
router.post('/create', controller.createGroup);
router.put('/:groupId/update', controller.updatedGroup);
router.post('/add', controller.addMemberToGroup);
router.delete('/remove', controller.removeMemberFromGroup);

export default router;

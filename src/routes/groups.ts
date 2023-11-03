import { Router } from 'express';
import * as controller from '../controllers/group';
import { checkPrivilege } from '../middleware/auth';

const router = Router();

router.use(checkPrivilege('group'));
router.get('/', controller.getGroups);
router.get('/:groupId', controller.getGroup);
router.post('/create', controller.createGroup);
router.put('/:groupId/update', controller.updatedGroup);
router.post('/add', controller.addMemberToGroup);
router.delete('/remove', controller.removeMembersFromGroup);
router.delete('/', controller.deleteGroups);

export default router;

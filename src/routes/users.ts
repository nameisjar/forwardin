import { Router } from 'express';
import * as controller from '../controllers/user';
import { checkPrivilege } from '../middleware/auth';

const router = Router();

router.use(checkPrivilege('user'));
router.get('/:userId', controller.getUserProfile);
router.get('/:userId/subscription', controller.getUserSubscriptionDetail);
// router.put('/:userId/update', controller.updateUser);
router.delete('/:userId/delete', controller.deleteUser);

export default router;

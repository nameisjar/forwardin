import { Router } from 'express';
import * as controller from '../controllers/user';
import { checkPrivilege } from '../middleware/auth';

const router = Router();

router.use(checkPrivilege('user'));
router.get('/:userId', controller.getUserProfile);
router.get('/subscription', controller.getUserSubscriptionDetail);
// router.put('/update', controller.updateUser);
router.delete('/delete', controller.deleteUser);

export default router;

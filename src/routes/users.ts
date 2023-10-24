import { Router } from 'express';
import * as controller from '../controllers/user';

const router = Router();
router.get('/', controller.getUserProfile);
router.get('/:userId/subscription', controller.getUserSubscriptionQuota);
// router.put('/update', controller.updateUser);
router.delete('/delete', controller.deleteUser);

export default router;

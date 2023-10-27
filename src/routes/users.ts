import { Router } from 'express';
import * as controller from '../controllers/user';

const router = Router();
router.get('/', controller.getUserProfile);
router.get('/subscription', controller.getUserSubscriptionDetail);
// router.put('/update', controller.updateUser);
router.delete('/delete', controller.deleteUser);

export default router;

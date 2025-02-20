import { Router } from 'express';
import * as controller from '../controllers/user';
import { checkPrivilege, isEmailVerified, superAdminOnly } from '../middleware/auth';

const router = Router();

router.use(checkPrivilege('user'));
router.get('/:userId', controller.getUserProfile);
router.get('/:userId/subscription', controller.getUserSubscriptionDetail);
router.get('/:userId/notifications', controller.getNotifications);
router.get('/:userId/notifications/:notificationId', controller.getNotificationById);
router.patch('/:userId', controller.updateUser);
router.patch('/change-email/:userId', controller.changeEmail);
router.patch('/change-phone-number/:userId', controller.changePhoneNumber);
router.get('/customer-services/:userId', controller.getCustomerServices);

router.use(isEmailVerified);
router.delete('/:userId/delete', controller.deleteUser);

export default router;

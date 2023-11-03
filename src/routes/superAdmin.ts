import { Router } from 'express';
import * as controller from '../controllers/user';
import subscriptionPlanRoutes from './subscriptionPlans';
import { checkPrivilege, superAdminOnly } from '../middleware/auth';

const router = Router();

router.use(superAdminOnly);
router.get('/users', checkPrivilege('user'), controller.getUsers);
router.use('/subscriptions', checkPrivilege('subscriptionPlan'), subscriptionPlanRoutes);

export default router;

import express from 'express';
import {
    createSubscriptionPlan,
    getAllSubscriptionPlans,
    getSubscriptionPlanById,
    updateSubscriptionPlan,
    deleteSubscriptionPlan,
    deleteSubscriptionPlans,
} from '../controllers/subscriptionPlan';
import { checkPrivilege, superAdminOnly } from '../middleware/auth';

const router = express.Router();

router.use(superAdminOnly);
router.use(checkPrivilege('subscriptionPlan'));
router.post('/', createSubscriptionPlan);
router.get('/', getAllSubscriptionPlans);
router.get('/:id', getSubscriptionPlanById);
router.put('/:id', updateSubscriptionPlan);
router.delete('/:id', deleteSubscriptionPlan);
router.delete('/', deleteSubscriptionPlans);

export default router;

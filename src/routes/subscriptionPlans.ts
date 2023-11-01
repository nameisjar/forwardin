import express from 'express';
import {
    createSubscriptionPlan,
    getAllSubscriptionPlans,
    getSubscriptionPlanById,
    updateSubscriptionPlan,
    deleteSubscriptionPlan,
} from '../controllers/subscriptionPlan';
import { isSuperAdmin } from '../middleware/auth';

const router = express.Router();

router.use(isSuperAdmin);
router.post('/subscription-plans', createSubscriptionPlan);
router.get('/subscription-plans', getAllSubscriptionPlans);
router.get('/subscription-plans/:id', getSubscriptionPlanById);
router.put('/subscription-plans/:id', updateSubscriptionPlan);
router.delete('/subscription-plans/:id', deleteSubscriptionPlan);

export default router;

import express from 'express';
import * as controller from '../controllers/superAdmin';
import { superAdminOnly } from '../middleware/auth';
import { checkPrivilege } from '../middleware/auth';

const router = express.Router();

router.use(superAdminOnly);
// router.use(checkPrivilege('superAdmin'));
router.get('/transaction', controller.getTransactions);
router.put('/transaction/:transactionId/status', controller.updateStatusTransaction);

export default router;

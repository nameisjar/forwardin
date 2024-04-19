import express from 'express';
import * as controller from '../controllers/superAdmin';
import authMiddleware, { superAdminOnly } from '../middleware/auth';
import { checkPrivilege } from '../middleware/auth';
import { auth } from 'googleapis/build/src/apis/abusiveexperiencereport';

const router = express.Router();
router.post('/login', controller.login);
router.use(authMiddleware);
router.use(superAdminOnly);
router.use(checkPrivilege('superAdmin'));
router.post('/add', controller.addSuperAdmin);
router.get('/', controller.getSuperAdmins);
// router.get('/transaction', controller.getTransactions);
router.put('/transaction/:transactionId/status', controller.updateStatusTransaction);
router.post('/user', controller.createUserAdmin);
router.get('/users', controller.getUsers);
router.put('/users/:userId', controller.updateUser);
router.put('/users/:userId/subscriptions', controller.updateSubscription);
router.delete('/users/:userId', controller.deleteUser);

export default router;

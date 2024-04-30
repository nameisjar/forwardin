import express from 'express';
import * as controller from '../controllers/superAdmin';
import authMiddleware, { superAdminOnly } from '../middleware/auth';
import { checkPrivilege } from '../middleware/auth';

const router = express.Router();
router.post('/login', controller.login);
router.use(authMiddleware);
router.use(superAdminOnly);
router.use(checkPrivilege('superAdmin'));
router.post('/add', controller.addSuperAdmin);
router.post('/user', controller.createUserAdmin);
router.get('/', controller.getSuperAdmins);
router.get('/users', controller.getUsers);
router.get('/transactions', controller.getTransactions);
router.put('/transaction/:transactionId/status', controller.updateStatusTransaction);
router.put('/users/:userId', controller.updateUser);
router.put('/users/:userId/subscriptions', controller.updateSubscription);
router.delete('/users', controller.deleteUsers);
router.delete('/users/:userId', controller.deleteUserById);

export default router;

import { Router } from 'express';
import * as controller from '../controllers/customerService';
import authMiddleware, { checkPrivilege } from '../middleware/auth';

const router = Router();

router.post('/login', controller.login);

router.use(authMiddleware);
router.use(checkPrivilege('customerService'));
router.post('/register', controller.registerCS);
router.get('/:userId', controller.getCustomerServices);
router.put('/:csId', controller.updateCS);

export default router;

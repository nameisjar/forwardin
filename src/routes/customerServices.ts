import { Router } from 'express';
import * as controller from '../controllers/customerService';
import { accessToken, checkPrivilege } from '../middleware/auth';

const router = Router();

router.post('/login', controller.login);

router.use(accessToken);
router.use(checkPrivilege('customerService'));
router.post('/register', controller.registerCS);

export default router;

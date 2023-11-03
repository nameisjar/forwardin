import { Router } from 'express';
import * as controller from '../controllers/customerService';
import { checkPrivilege } from '../middleware/auth';

const router = Router();

router.use(checkPrivilege('customerService'));
router.post('/', controller.registerCS);

export default router;

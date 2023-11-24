import { Router } from 'express';
import * as controller from '../controllers/order';
import { checkPrivilege } from '../middleware/auth';

const router = Router();
router.use(checkPrivilege('order'));

router.get('/', controller.getOrderMessages);
router.post('/', controller.createOrderMessages);

export default router;

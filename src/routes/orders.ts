import { Router } from 'express';
import * as controller from '../controllers/order';
import { checkPrivilege } from '../middleware/auth';

const router = Router();
router.use(checkPrivilege('order'));

router.post('/', controller.createOrder);
router.get('/', controller.getOrders);
router.patch('/:orderId', controller.updateOrderStatus);

router.get('/messages', controller.getOrderMessages);
router.post('/messages', controller.createOrderMessages);

export default router;

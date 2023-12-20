import { Router } from 'express';
import * as controller from '../controllers/analytics';
import { checkPrivilege } from '../middleware/auth';

const router = Router();

router.use(checkPrivilege('analytics'));
router.get('/orders/:customerServiceId', controller.getOrder);
router.get('/messages', controller.getMessageStatistics);

export default router;

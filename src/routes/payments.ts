import { Router } from 'express';
import * as controller from '../controllers/payment';

const router = Router();

router.post('/notification', controller.handleNotification);

export default router;

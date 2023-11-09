import express from 'express';
import * as controller from '../controllers/businessHour';
import { checkPrivilege } from '../middleware/auth';

const router = express.Router();

router.use(checkPrivilege('businessHour'));
router.post('/', controller.createBusinessHour);
router.get('/:id', controller.getAllBusinessHours);

export default router;

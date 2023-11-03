import express from 'express';
import * as controller from '../controllers/broadcast';
import { checkPrivilege } from '../middleware/auth';

const router = express.Router();

router.use(checkPrivilege('broadcast'));
router.post('/', controller.createBroadcast);

export default router;

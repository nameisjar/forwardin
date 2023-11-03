import express from 'express';
import * as controller from '../controllers/autoReply';
import { checkPrivilege } from '../middleware/auth';

const router = express.Router();

router.use(checkPrivilege('autoReply'));
router.post('/', controller.createAutoReply);
router.get('/', controller.getAutoReplies);

export default router;

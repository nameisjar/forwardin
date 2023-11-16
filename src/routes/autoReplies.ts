import express from 'express';
import * as controller from '../controllers/autoReply';
import { checkPrivilege } from '../middleware/auth';

const router = express.Router();

router.use(checkPrivilege('autoReply'));
router.post('/', controller.createAutoReplies);
router.get('/', controller.getAutoReplies);
router.get('/:id', controller.getAutoReply);
router.get('/:id/recipients', controller.getAutoReplyRecipients);
router.put('/:id', controller.updateAutoReply);
router.delete('/', controller.deleteAutoReplies);

export default router;

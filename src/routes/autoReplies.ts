import express from 'express';
import * as controller from '../controllers/autoReply';

const router = express.Router();

router.post('/', controller.createAutoReply);
router.get('/', controller.getAutoReplies);

export default router;

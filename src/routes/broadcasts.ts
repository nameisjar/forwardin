import express from 'express';
import * as controller from '../controllers/broadcast';

const router = express.Router();

router.post('/', controller.createBroadcast);

export default router;

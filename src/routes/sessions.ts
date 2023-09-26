import { Router } from 'express';
import * as controller from '../controllers/session';

const router = Router();

router.post('/create', controller.createSession);

export default router;

import { Router } from 'express';
import * as controller from '../controllers/session';

const router = Router();

router.post('/create', controller.create);

export default router;

import { Router } from 'express';
import * as controller from '../controllers/group';

const router = Router();
router.get('/', controller.getGroups);

export default router;

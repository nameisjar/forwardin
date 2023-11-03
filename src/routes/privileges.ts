import express from 'express';
import * as controller from '../controllers/privilege';
import { checkPrivilege, superAdminOnly } from '../middleware/auth';

const router = express.Router();

router.use(superAdminOnly);
router.use(checkPrivilege('privilege'));
router.get('/', controller.getPrivileges);

export default router;

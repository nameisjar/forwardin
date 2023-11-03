import express from 'express';
import * as controller from '../controllers/menu';
import { checkPrivilege, superAdminOnly } from '../middleware/auth';

const router = express.Router();

router.use(checkPrivilege('menu'));
router.get('/:userId', controller.getMenusByUserId);

router.use(superAdminOnly);
router.get('/', controller.getMenus);
router.post('/', controller.assignPrivilegetoMenu);

export default router;

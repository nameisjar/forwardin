import express from 'express';
import * as controller from '../controllers/template';
import { checkPrivilege } from '../middleware/auth';

const router = express.Router();

router.use(checkPrivilege('template'));
router.post('/', controller.createTemplate);
router.get('/', controller.getTemplates);
router.delete('/', controller.deleteTemplates);

export default router;

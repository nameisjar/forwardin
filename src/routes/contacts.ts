import { Router } from 'express';
import * as controller from '../controllers/contact';
import { dateRules, validate } from '../middleware/requestValidator';

const router = Router();

router.post('/create', dateRules, validate, controller.createContact);
router.get('/', controller.getContacts);
router.get('/:contactId', controller.getContact);
router.put('/:contactId', dateRules, validate, controller.updateContact);
router.delete('/:contactId', controller.deleteContact);
router.post('/add', controller.addContactToGroup);

export default router;

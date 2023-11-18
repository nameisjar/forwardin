import { Router } from 'express';
import * as controller from '../controllers/contact';
import { dateRules, validate } from '../middleware/requestValidator';
import { checkPrivilege } from '../middleware/auth';
import { checkSubscriptionQuota, isContactQuotaAvailable } from '../middleware/subscription';

const router = Router();

router.use(checkPrivilege('contact'));
router.post(
    '/create',
    dateRules,
    validate,
    checkSubscriptionQuota,
    isContactQuotaAvailable,
    controller.createContact,
);
router.post('/import', checkSubscriptionQuota, isContactQuotaAvailable, controller.importContacts);
router.get('/', controller.getContacts);
router.get('/labels', controller.getContactLabels);
router.get('/:contactId', controller.getContact);
router.put('/:contactId', dateRules, validate, controller.updateContact);
router.delete('/', controller.deleteContacts);
router.post('/add', controller.addContactToGroup);

export default router;

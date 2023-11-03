import express from 'express';
import * as controller from '../controllers/campaign';
import { checkPrivilege } from '../middleware/auth';

const router = express.Router();

router.use(checkPrivilege('campaign'));
router.post('/', controller.createCampaign);
router.post('/:campaignId/messages', controller.createCampaignMessage);

export default router;

import express from 'express';
import * as controller from '../controllers/campaign';
import { checkPrivilege } from '../middleware/auth';

const router = express.Router();

router.use(checkPrivilege('campaign'));
router.post('/', controller.createCampaign);
router.get('/:deviceId', controller.getAllCampaigns);
router.post('/:campaignId/messages', controller.createCampaignMessage);
router.get('/:campaignId/messages', controller.getAllCampaignMessagess);

export default router;

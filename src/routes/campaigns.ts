import express from 'express';
import * as controller from '../controllers/campaign';
import { checkPrivilege } from '../middleware/auth';

const router = express.Router();

router.use(checkPrivilege('campaign'));
router.post('/', controller.createCampaign);
router.get('/', controller.getAllCampaigns);
router.get('/:campaignId', controller.getCampaign);
router.get('/:campaignId/replies', controller.getCampaignReplies);
router.get('/:campaignId/outgoing', controller.getOutgoingCampaigns);
router.post('/messages', controller.createCampaignMessage);
router.get('/:campaignId/messages', controller.getAllCampaignMessagess);

export default router;

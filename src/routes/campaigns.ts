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
router.put('/:campaignId', controller.updateCampaign);
router.delete('/', controller.deleteCampaigns);

router.post('/messages/', controller.createCampaignMessage);
router.get('/:campaignId/messages/', controller.getAllCampaignMessages);
router.get('/messages/:campaignMessageId', controller.getCampaignMessage);
router.get('/messages/:campaignMessageId/replies', controller.getCampaignMessageReplies);
router.get('/messages/:campaignMessageId/outgoing', controller.getOutgoingCampaignMessages);
router.put('/messages/:campaignMessageId', controller.updateCampaignMessage);
router.delete('/messages/', controller.deleteCampaignMessages);

export default router;

import express from 'express';
import * as controller from '../controllers/campaign';

const router = express.Router();

router.post('/', controller.createCampaign);
router.post('/:campaignId/messages', controller.createCampaignMessage);

export default router;

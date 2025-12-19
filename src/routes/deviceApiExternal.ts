import { Router } from 'express';
import * as sessionController from '../controllers/session';

const router = Router();

router.get('/ping', (req, res) => {
    res.status(200).json({ ok: true, message: 'api-external ready' });
});

// External-only: get sessions by device API key
router.get('/sessions/:deviceApiKey', sessionController.getSessionsByDeviceApiKey);

export default router;

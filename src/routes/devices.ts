import { Router } from 'express';
import * as controller from '../controllers/device';

const router = Router();

router.get('/', controller.getAllDevices);
// router.post('/devices', deviceController.createDevice);
// router.get('/devices/:deviceId', deviceController.getDeviceById);
// router.put('/devices/:deviceId', deviceController.updateDevice);
// router.delete('/devices/:deviceId', deviceController.deleteDevice);

export default router;

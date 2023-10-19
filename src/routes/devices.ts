import { Router } from 'express';
import * as controller from '../controllers/device';

const router = Router();

router.get('/', controller.getDevices);
router.get('/labels', controller.getDeviceLabels);
router.post('/create', controller.createDevice);
router.get('/:deviceId', controller.getDevice);
router.put('/:deviceId', controller.updateDevice);
router.delete('/', controller.deleteDevices);

export default router;

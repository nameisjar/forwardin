import { Router } from 'express';
import * as controller from '../controllers/device';

const router = Router();

router.get('/', controller.getDevices);
router.post('/create', controller.createDevice);
router.get('/:deviceId', controller.getDevice);
router.put('/:deviceId', controller.updateDevice);
router.delete('/:deviceId', controller.deleteDevice);

export default router;

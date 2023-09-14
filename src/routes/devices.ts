import { Router } from 'express';
import * as controller from '../controllers/device';

const router = Router();

router.get('/', controller.getAllDevices);
router.post('/', controller.createDevice);
// router.get('/:deviceId', deviceController.getDeviceById);
// router.put('/:deviceId', deviceController.updateDevice);
// router.delete('/:deviceId', controller.deleteDevice);

export default router;

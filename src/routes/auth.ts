import { Router } from 'express';
import * as controller from '../controllers/auth';
import {
    emailRules,
    passwordRules,
    registerValidationRules,
    validate,
} from '../middleware/requestValidator';
import { authenticateUser } from '../middleware/auth';

const router = Router();
router.post('/register', registerValidationRules, validate, controller.register);
router.post('/check-identifier-availability', controller.checkIdentifierAvailability);
router.post('/login', controller.login);
router.post('/refresh-token', controller.refreshToken);
router.post('/forgot-password', controller.forgotPassword);
router.post('/reset-password', passwordRules, emailRules, validate, controller.resetPassword);
// router.get('/auth/google', controller.googleAuth);
// router.get('/auth/facebook', controller.facebookAuth);

router.use(authenticateUser);
router.post('/send-verification-email', controller.sendVerificationEmail);
router.post('/verify-email', controller.verifyEmail);
router.put('/change-password', passwordRules, validate, controller.changePassword);
// router.post('/logout', controller.logout);

export default router;

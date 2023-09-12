import { Router } from 'express';
import * as controller from '../controllers/auth';
import {
    emailRules,
    passwordRules,
    registerValidationRules,
    validate,
} from '../middleware/requestValidator';

const router = Router();
router.post('/register', registerValidationRules, validate, controller.register);
router.post('/check-identifier-availability', controller.checkIdentifierAvailability);
router.post('/login', controller.login);
// router.post('/logout', controller.logout);
router.post('/send-verification-email', controller.sendVerificationEmail);
router.post('/verify-email', controller.verifyEmail);
router.post('/forgot-password', controller.forgotPassword);
router.post('/reset-password', passwordRules, emailRules, validate, controller.resetPassword);
router.post('/refresh-token', controller.refreshToken);
router.put('/change-password', passwordRules, emailRules, validate, controller.changePassword);
// router.delete('/delete-account', controller.deleteAccount);
// router.get('/auth/google', controller.googleAuth);
// router.get('/auth/facebook', controller.facebookAuth);

export default router;

import { Router } from 'express';
import { handleRequestOTP, handleVerifyOTP, handleCompleteProfile, handleLogin, handleChangePin, handleResetPin} from '../controllers/authController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

router.post('/request-otp', handleRequestOTP);
router.post('/verify-otp', handleVerifyOTP);
router.post('/complete-profile', handleCompleteProfile)
router.post('/login', handleLogin);
router.post('/reset-pin', handleResetPin);      // OTP-verified, no token needed

// Protected — must be logged in
router.post('/change-pin', authenticate, handleChangePin);


export default router;
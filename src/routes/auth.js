import { Router } from 'express';
import { handleRequestOTP, handleVerifyOTP, handleCompleteProfile } from '../controllers/authController.js';

const router = Router();

router.post('/request-otp', handleRequestOTP);
router.post('/verify-otp', handleVerifyOTP);
router.post('/complete-profile', handleCompleteProfile)

export default router;
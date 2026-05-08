import { Router } from 'express';
import { handleRequestOTP, handleVerifyOTP } from '../controllers/authController.js';

const router = Router();

router.post('/request-otp', handleRequestOTP);
router.post('/verify-otp', handleVerifyOTP);

export default router;
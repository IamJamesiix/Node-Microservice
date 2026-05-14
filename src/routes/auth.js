import { Router } from 'express';
import {
  handleRequestOTP,
  handleVerifyOTP,
  handleCompleteProfile,
  handleLogin,
  handleChangePin,
  handleResetPinRequest,   // updated
  handleResetPinConfirm,   // updated
} from '../controllers/authController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = Router();

router.post('/request-otp', handleRequestOTP);
router.post('/verify-otp', handleVerifyOTP);
router.post('/complete-profile', handleCompleteProfile);
router.post('/login', handleLogin);
router.post('/reset-pin/request', handleResetPinRequest);    // step 1
router.post('/reset-pin/confirm', handleResetPinConfirm);    // step 2
router.post('/change-pin', authenticate, handleChangePin);

export default router;
import { requestOTP, verifyOTP } from '../services/otpService.js';
import axios from 'axios';
import config from '../config/dotenv.js';

export async function handleRequestOTP(req, res) {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone is required' });

    const result = await requestOTP(phone);
    return res.json(result);
  } catch (err) {
    console.error('requestOTP error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export async function handleVerifyOTP(req, res) {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ error: 'phone and otp are required' });

    await verifyOTP(phone, otp);

    // On success → call Django to create the user + Squad wallet
    const djangoRes = await axios.post(`${config.DJANGO_API_URL}/api/users/create/`, { phone });

    return res.json({
      message: 'OTP verified',
      user: djangoRes.data,
    });
  } catch (err) {
    console.error('verifyOTP error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}
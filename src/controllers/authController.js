import { requestOTP, verifyOTP } from '../services/otpService.js';
import axios from 'axios';
import config from '../config/dotenv.js';

const DJANGO = config.DJANGO_API_URL;
const INTERNAL = { 'X-Internal-Secret': config.DJANGO_API_SECRET };

// ── Request OTP ──────────────────────────────────────────────
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

// ── Verify OTP (step 1 of 2) ─────────────────────────────────
// Just validates the OTP — does NOT call Django yet.
// Client must follow up with POST /auth/complete-profile.
export async function handleVerifyOTP(req, res) {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      return res.status(400).json({ error: 'phone and otp are required' });
    }

    await verifyOTP(phone, otp);

    return res.json({ verified: true, phone });
  } catch (err) {
    console.error('verifyOTP error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

// ── Complete Profile (step 2 of 2) ───────────────────────────
// Accepts all profile fields and creates the user in Django.
// Called by the mobile app after a successful /auth/verify-otp.
//
// Required: phone, name, email, dob (YYYY-MM-DD), bvn (11 digits)
// Optional: gender ('M' | 'F'), address
export async function handleCompleteProfile(req, res) {
  try {
    const { phone, name, email, dob, bvn, gender, address } = req.body;

    // Validate required fields
    if (!phone || !name || !email || !dob || !bvn) {
      return res.status(400).json({
        error: 'phone, name, email, dob, and bvn are required',
      });
    }

    if (!/^\d{11}$/.test(bvn)) {
      return res.status(400).json({ error: 'BVN must be exactly 11 digits' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      return res.status(400).json({ error: 'dob must be in YYYY-MM-DD format' });
    }

    if (!/.+@.+\..+/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const djangoRes = await axios.post(
      `${DJANGO}/api/users/create/`,
      {
        phone,
        name,
        email,
        dob,
        bvn,
        gender: gender || null,
        address: address || null,
      },
      { headers: INTERNAL, timeout: 8000 }
    );

    return res.json({
      message: 'Profile complete',
      user: djangoRes.data,
    });
  } catch (err) {
    console.error('completeProfile error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}
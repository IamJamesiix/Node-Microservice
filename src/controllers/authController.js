import { requestOTP, verifyOTP } from '../services/otpService.js';
import axios from 'axios';
import config from '../config/dotenv.js';

const DJANGO = config.DJANGO_API_URL;
const INTERNAL = { 'X-Internal-Secret': config.DJANGO_API_SECRET };

// ── Normalize phone to E.164 ─────────────────────────────────
function normalizePhone(raw) {
  // Strip everything that isn't a digit or leading +
  const hasPlus = String(raw).startsWith('+');
  const clean = String(raw).replace(/\D/g, '');
 
  // Already full E.164 digits: 2348012345678 (13 digits)
  if (clean.startsWith('234') && clean.length === 13) return `+${clean}`;
 
  // Local with leading zero: 08012345678 (11 digits)
  if (clean.startsWith('0') && clean.length === 11) return `+234${clean.slice(1)}`;
 
  // Local without leading zero: 8012345678 (10 digits)
  if (clean.length === 10 && !clean.startsWith('0')) return `+234${clean}`;
 
  // Already had + and looks right
  if (hasPlus && clean.length === 13) return `+${clean}`;
 
  // Fallback
  return hasPlus ? `+${clean}` : clean;
}

// ── Request OTP ──────────────────────────────────────────────
export async function handleRequestOTP(req, res) {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone is required' });

    const result = await requestOTP(normalizePhone(phone));
    return res.json(result);
  } catch (err) {
    console.error('requestOTP error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── Verify OTP ───────────────────────────────────────────────
export async function handleVerifyOTP(req, res) {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      return res.status(400).json({ error: 'phone and otp are required' });
    }

    await verifyOTP(normalizePhone(phone), otp);
    return res.json({ verified: true, phone: normalizePhone(phone) });
  } catch (err) {
    console.error('verifyOTP error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

// ── Complete Profile ─────────────────────────────────────────
export async function handleCompleteProfile(req, res) {
  try {
    const {
      phone, full_name, email, date_of_birth, bvn,
      pin, gender, address, role,
      location_area, location_city,
      skills, languages, has_vehicle, vehicle_type,
      availability, trade_category, market_name,
      weekly_income_range, business_name,
    } = req.body;

    // Required fields
    if (!phone || !full_name || !email || !date_of_birth || !bvn || !pin || !role) {
      return res.status(400).json({
        error: 'phone, full_name, email, date_of_birth, bvn, pin, and role are required',
      });
    }

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    }

    if (!/^\d{11}$/.test(bvn)) {
      return res.status(400).json({ error: 'BVN must be exactly 11 digits' });
    }

    if (!['worker', 'trader', 'employer'].includes(role)) {
      return res.status(400).json({ error: 'role must be worker, trader, or employer' });
    }

    if (!/.+@.+\..+/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const normalizedPhone = normalizePhone(phone);

    console.log('Calling Django at:', `${DJANGO}/api/auth/register/`);
    console.log('INTERNAL headers:', INTERNAL);

    const djangoRes = await axios.post(
      `${DJANGO}/api/auth/register/`,
      {
        phone: normalizedPhone,
        full_name,
        email,
        date_of_birth,
        bvn,
        pin,
        role,
...(gender && { gender }),
...(address && { address }),
...(location_area && { location_area }),
...(location_city && { location_city }),
        skills: skills || [],
        languages: languages || [],
        has_vehicle: has_vehicle || false,
...(vehicle_type && vehicle_type !== 'none' && { vehicle_type }),
        availability: availability || 'full_day',
...(trade_category && { trade_category }),
...(market_name && { market_name }),
...(weekly_income_range && { weekly_income_range }),
...(business_name && { business_name }),
        channel: 'app',
      },
      { headers: INTERNAL, timeout: 8000 }
    );

    const { tokens, user } = djangoRes.data.data;

    return res.status(201).json({
      message: 'Profile complete',
      tokens,   // pass Django's tokens directly — no need to issue our own
      user,
    });

  } catch (err) {
    console.error('completeProfile error:', err.message);
    if (err.response) {
      console.error('Django error:', JSON.stringify(err.response.data, null, 2));
      return res.status(err.response.status).json({
        error: err.message,
        django_error: err.response.data,
      });
    }
    return res.status(500).json({ error: err.message });
  }
}

// ── Login ────────────────────────────────────────────────────
export async function handleLogin(req, res) {
  try {
    const { phone, pin } = req.body;

    if (!phone || !pin) {
      return res.status(400).json({ error: 'phone and pin are required' });
    }

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    }

    const normalizedPhone = normalizePhone(phone);

    let djangoRes;
    try {
      djangoRes = await axios.post(
        `${DJANGO}/api/auth/login/`,
        { phone: normalizedPhone, pin },
        { headers: INTERNAL, timeout: 15000 }
      );
    } catch (err) {
      if (err.response?.status === 401) {
        return res.status(401).json({ error: 'Invalid phone number or PIN.' });
      }
      if (err.response?.status === 404) {
        return res.status(404).json({ error: 'Phone number not registered.' });
      }
      throw err;
    }

    const { tokens, user } = djangoRes.data;

    return res.json({
      message: 'Login successful',
      tokens,
      user,
    });

  } catch (err) {
    console.error('login error:', err.message);
    if (err.response) {
      console.error('Django error:', JSON.stringify(err.response.data, null, 2));
      return res.status(err.response.status).json({
        error: err.message,
        django_error: err.response.data,
      });
    }
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

// ── Change PIN ───────────────────────────────────────────────
export async function handleChangePin(req, res) {
  try {
    const { phone, old_pin, new_pin } = req.body;

    if (!phone || !old_pin || !new_pin) {
      return res.status(400).json({ error: 'phone, old_pin, and new_pin are required' });
    }

    if (!/^\d{4}$/.test(old_pin) || !/^\d{4}$/.test(new_pin)) {
      return res.status(400).json({ error: 'PINs must be exactly 4 digits' });
    }

    if (old_pin === new_pin) {
      return res.status(400).json({ error: 'New PIN must be different from old PIN' });
    }

    await axios.post(
      `${DJANGO}/api/auth/change-pin/`,
      { phone: normalizePhone(phone), old_pin, new_pin },
      { headers: INTERNAL, timeout: 5000 }
    );

    return res.json({ message: 'PIN changed successfully' });

  } catch (err) {
    console.error('changePin error:', err.message);
    if (err.response?.status === 401) {
      return res.status(401).json({ error: 'Old PIN is incorrect.' });
    }
    if (err.response) {
      return res.status(err.response.status).json({
        error: err.message,
        django_error: err.response.data,
      });
    }
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

// ── Reset PIN ────────────────────────────────────────────────
export async function handleResetPinRequest(req, res) {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone is required' });

    await axios.post(
      `${DJANGO}/api/auth/reset-pin/request/`,
      { phone: normalizePhone(phone) },
      { headers: INTERNAL, timeout: 5000 }
    );

    return res.json({ message: 'OTP sent to your phone. Use it to confirm PIN reset.' });
  } catch (err) {
    console.error('resetPinRequest error:', err.message);
    if (err.response) {
      return res.status(err.response.status).json({
        error: err.message,
        django_error: err.response.data,
      });
    }
    return res.status(500).json({ error: err.message });
  }
}

export async function handleResetPinConfirm(req, res) {
  try {
    const { phone, otp, new_pin } = req.body;

    if (!phone || !otp || !new_pin) {
      return res.status(400).json({ error: 'phone, otp, and new_pin are required' });
    }

    if (!/^\d{4}$/.test(new_pin)) {
      return res.status(400).json({ error: 'new_pin must be exactly 4 digits' });
    }

    await axios.post(
      `${DJANGO}/api/auth/reset-pin/confirm/`,
      { phone: normalizePhone(phone), otp, new_pin },
      { headers: INTERNAL, timeout: 5000 }
    );

    return res.json({ message: 'PIN reset successfully. Please log in.' });
  } catch (err) {
    console.error('resetPinConfirm error:', err.message);
    if (err.response) {
      return res.status(err.response.status).json({
        error: err.message,
        django_error: err.response.data,
      });
    }
    return res.status(400).json({ error: err.message });
  }
}
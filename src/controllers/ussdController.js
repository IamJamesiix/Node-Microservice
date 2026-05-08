import { getSession, setSession, clearSession } from '../services/ussdSessionService.js';
import { requestOTP, verifyOTP } from '../services/otpService.js';
import { createVirtualAccount } from '../services/squadService.js';
import axios from 'axios';
import config from '../config/dotenv.js';

export async function handleUSSD(req, res) {
  const { sessionId, serviceCode, phoneNumber, text } = req.body;

  // Africa's Talking sends accumulated input as `text`, split by *
  const parts = text ? text.split('*') : [];
  const currentInput = parts[parts.length - 1];
  const stepCount = parts.filter(Boolean).length;

  let session = await getSession(sessionId);
  let response = '';
  let isEnd = false;

  try {
    // ── STEP 0: Welcome ──────────────────────────────────────
    if (!text || text === '') {
      session = { step: 'welcome', data: { phone: phoneNumber } };
      await setSession(sessionId, session);

      response = `CON Welcome to Trybe 🌟
Your economic identity platform.

1. Register / Login
2. Check Balance
3. Send Money
0. Exit`;
    }

    // ── STEP 1: Main Menu selection ──────────────────────────
    else if (stepCount === 1) {
      const choice = currentInput;

      if (choice === '1') {
        session.step = 'otp_sent';
        await requestOTP(phoneNumber);
        await setSession(sessionId, session);
        response = `CON An OTP has been sent to ${phoneNumber}.
Enter the 6-digit code:`;
      } else if (choice === '2') {
        session.step = 'check_balance';
        await setSession(sessionId, session);
        response = `CON Enter your account number:`;
      } else if (choice === '3') {
        session.step = 'send_money';
        await setSession(sessionId, session);
        response = `CON Enter recipient phone number:`;
      } else if (choice === '0') {
        isEnd = true;
        response = `END Thank you for using Trybe. Goodbye!`;
        await clearSession(sessionId);
      } else {
        response = `CON Invalid option. Please try again.
1. Register / Login
2. Check Balance
3. Send Money
0. Exit`;
      }
    }

    // ── STEP 2: OTP entry (Register/Login) ───────────────────
    else if (stepCount === 2 && session.step === 'otp_sent') {
      const otp = currentInput;

      try {
        await verifyOTP(phoneNumber, otp);

        // Call Django to create/fetch user
        const djangoRes = await axios.post(`${config.DJANGO_API_URL}/api/users/create/`, {
          phone: phoneNumber,
        });

        const user = djangoRes.data;
        const accountNumber = user.virtual_account_number || 'N/A';
        const bankName = user.bank_name || 'Squad MFB';

        isEnd = true;
        response = `END ✅ Verified! Welcome to Trybe.
Your account:
${accountNumber}
Bank: ${bankName}

You can now receive payments!`;
        await clearSession(sessionId);
      } catch (err) {
        isEnd = true;
        response = `END ❌ ${err.message}. Please try again.`;
        await clearSession(sessionId);
      }
    }

    // ── STEP 2: Balance check ────────────────────────────────
    else if (stepCount === 2 && session.step === 'check_balance') {
      // Stub — Django will handle real balance
      isEnd = true;
      response = `END Balance feature coming soon.
Dial back to register first.`;
      await clearSession(sessionId);
    }

    // ── Fallback ─────────────────────────────────────────────
    else {
      isEnd = true;
      response = `END Session error. Please try again.`;
      await clearSession(sessionId);
    }
  } catch (err) {
    console.error('USSD error:', err.message);
    isEnd = true;
    response = `END Something went wrong. Please try again later.`;
    await clearSession(sessionId);
  }

  // Africa's Talking expects plain text response
  res.set('Content-Type', 'text/plain');
  res.send(response);
}
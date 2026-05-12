import { getSession, setSession, clearSession } from '../services/ussdSessionService.js';
import { requestOTP, verifyOTP } from '../services/otpService.js';
import { sendSMS } from '../services/smsService.js';
import axios from 'axios';
import config from '../config/dotenv.js';

const DJANGO = config.DJANGO_API_URL;
const INTERNAL = { 'X-Internal-Secret': config.DJANGO_API_SECRET };

// ── Helpers ──────────────────────────────────────────────────
function parseDOB(raw) {
  // Accepts DDMMYYYY → returns YYYY-MM-DD for Django
  const clean = raw.replace(/\D/g, '');
  if (clean.length !== 8) return null;
  const dd = clean.slice(0, 2);
  const mm = clean.slice(2, 4);
  const yyyy = clean.slice(4, 8);
  const d = new Date(`${yyyy}-${mm}-${dd}`);
  if (isNaN(d.getTime())) return null;
  return `${yyyy}-${mm}-${dd}`;
}

// ── Main handler ─────────────────────────────────────────────
export async function handleUSSD(req, res) {
  const { sessionId, serviceCode, phoneNumber, text } = req.body;

  const parts = text ? text.split('*') : [];
  const input = parts[parts.length - 1];
  const depth = parts.filter(Boolean).length;

  let session = await getSession(sessionId);
  let response = '';

  try {

    // ════════════════════════════════════════════════════
    // STATE 0: Welcome screen
    // ════════════════════════════════════════════════════
    if (!text || text === '') {
      session = { state: 'root', path: null, data: { phone: phoneNumber } };
      await setSession(sessionId, session);

      response = `CON Welcome to Kolliq 🌟
Your economic identity platform.

1. Sell goods
2. Look for work
3. Member login
0. Exit`;
    }

    // ════════════════════════════════════════════════════
    // ROOT ROUTING
    // ════════════════════════════════════════════════════
    else if (session.state === 'root') {
      if (input === '1') {
        session.state = 'trader_category';
        session.path = 'trader';
        await setSession(sessionId, session);
        response = `CON What do you sell?

1. Food & Provisions
2. Clothing & Fashion
3. Electronics
4. Building Materials
5. Other`;
      }
      else if (input === '2') {
        session.state = 'worker_otp';
        session.path = 'worker';
        await requestOTP(phoneNumber);
        await setSession(sessionId, session);
        response = `CON Code sent to ${phoneNumber}.
Enter the 6-digit OTP:`;
      }
      else if (input === '3') {
        session.state = 'member_phone';
        session.path = 'member';
        await setSession(sessionId, session);
        response = `CON Member Login
Enter your phone number:`;
      }
      else if (input === '0') {
        await clearSession(sessionId);
        response = `END Thank you for using Kolliq. Goodbye!`;
      }
      else {
        response = `CON Invalid choice. Try again.

1. Sell goods
2. Look for work
3. Member login
0. Exit`;
      }
    }

    // ════════════════════════════════════════════════════
    // TRADER PATH
    // ════════════════════════════════════════════════════
    else if (session.state === 'trader_category') {
      const categories = {
        '1': 'Food & Provisions',
        '2': 'Clothing & Fashion',
        '3': 'Electronics',
        '4': 'Building Materials',
        '5': 'Other',
      };
      session.data.category = categories[input] || 'Other';
      session.state = 'trader_market';
      await setSession(sessionId, session);

      response = `CON Which market do you trade in?

1. Balogun Market
2. Alaba Market
3. Wuse Market
4. Onitsha Main Market
5. Other`;
    }

    else if (session.state === 'trader_market') {
      const markets = {
        '1': 'Balogun Market',
        '2': 'Alaba Market',
        '3': 'Wuse Market',
        '4': 'Onitsha Main Market',
        '5': 'Other',
      };
      session.data.market = markets[input] || 'Other';
      session.state = 'trader_income';
      await setSession(sessionId, session);

      response = `CON Monthly income range?

1. Below 50,000
2. 50k - 150k
3. 150k - 500k
4. Above 500k`;
    }

    else if (session.state === 'trader_income') {
      const incomeRanges = {
        '1': '0-50000',
        '2': '50000-150000',
        '3': '150000-500000',
        '4': '500000+',
      };
      session.data.income_range = incomeRanges[input] || '0-50000';

      try {
        const djangoRes = await axios.post(`${DJANGO}/api/users/auth/register/`, {
          phone: phoneNumber,
          user_type: 'trader',
          category: session.data.category,
          market: session.data.market,
          income_range: session.data.income_range,
        }, { headers: INTERNAL, timeout: 5000 });

        const user = djangoRes.data;
        const accountNumber = user.virtual_account_number || 'Pending';
        const bankName = user.bank_name || 'Kolliq MFB';

        await sendSMS(
          phoneNumber,
          `✅ Kolliq: Registration successful!\nWallet: ${accountNumber}\nBank: ${bankName}\nDial back to check balance or apply for services.`
        );

        await clearSession(sessionId);
        response = `END ✅ Registration complete!

Wallet: ${accountNumber}
Bank: ${bankName}

Check your SMS for details.`;
      } catch (err) {
        await clearSession(sessionId);
        response = `END ❌ Registration failed. Please try again.`;
      }
    }

    // ════════════════════════════════════════════════════
    // WORKER PATH — OTP → Profile collection → Django
    // ════════════════════════════════════════════════════

    // Step 1: Verify OTP
    else if (session.state === 'worker_otp') {
      try {
        await verifyOTP(phoneNumber, input);
        session.state = 'worker_name';
        await setSession(sessionId, session);
        response = `CON OTP verified! ✅
Enter your full name:`;
      } catch (err) {
        await clearSession(sessionId);
        response = `END ❌ Invalid OTP. Please dial again.`;
      }
    }

    // Step 2: Full name
    else if (session.state === 'worker_name') {
      const name = input.trim();
      if (!name || name.length < 2) {
        response = `CON Name too short. Enter your full name:`;
      } else {
        session.data.name = name;
        session.state = 'worker_dob';
        await setSession(sessionId, session);
        response = `CON Date of birth?
Format: DDMMYYYY
e.g. 15091990`;
      }
    }

    // Step 3: Date of birth
    else if (session.state === 'worker_dob') {
      const dob = parseDOB(input);
      if (!dob) {
        response = `CON Invalid date. Use DDMMYYYY:
e.g. 15091990`;
      } else {
        session.data.dob = dob;
        session.state = 'worker_bvn';
        await setSession(sessionId, session);
        response = `CON Enter your BVN:
(11-digit number)`;
      }
    }

    // Step 4: BVN
    else if (session.state === 'worker_bvn') {
      const bvn = input.replace(/\D/g, '');
      if (bvn.length !== 11) {
        response = `CON BVN must be 11 digits.
Enter your BVN:`;
      } else {
        session.data.bvn = bvn;
        session.state = 'worker_email';
        await setSession(sessionId, session);
        response = `CON Enter your email address:
e.g. name@gmail.com`;
      }
    }

    // Step 5: Email
    else if (session.state === 'worker_email') {
      const email = input.trim().toLowerCase();
      if (!/.+@.+\..+/.test(email)) {
        response = `CON Invalid email. Try again:
e.g. name@gmail.com`;
      } else {
        session.data.email = email;
        session.state = 'worker_gender';
        await setSession(sessionId, session);
        response = `CON Gender:

1. Male
2. Female
3. Skip`;
      }
    }

    // Step 6: Gender (optional)
    else if (session.state === 'worker_gender') {
      const genderMap = { '1': 'M', '2': 'F' };
      session.data.gender = genderMap[input] || null;
      session.state = 'worker_address';
      await setSession(sessionId, session);
      response = `CON Home address (optional):
Type address or 0 to skip:`;
    }

    // Step 7: Address (optional) → call Django
    else if (session.state === 'worker_address') {
      session.data.address = (input === '0' || !input.trim()) ? null : input.trim();

      try {
        const djangoRes = await axios.post(`${DJANGO}/api/users/auth/register/`, {
          phone: phoneNumber,
          user_type: 'worker',
          name: session.data.name,
          email: session.data.email,
          dob: session.data.dob,
          bvn: session.data.bvn,
          gender: session.data.gender,
          address: session.data.address,
        }, { headers: INTERNAL, timeout: 8000 });

        const user = djangoRes.data;
        const accountNumber = user.virtual_account_number || 'Pending';
        const bankName = user.bank_name || 'Kolliq MFB';

        await sendSMS(
          phoneNumber,
          `✅ Kolliq: Welcome ${session.data.name}!\nWallet: ${accountNumber} (${bankName})\nYou can now receive payments for gigs.\nDial back to check your score or balance.`
        );

        await clearSession(sessionId);
        response = `END ✅ Welcome to Kolliq!

Wallet: ${accountNumber}
Bank: ${bankName}

SMS sent. Start earning! 💪`;
      } catch (err) {
        await clearSession(sessionId);
        response = `END ❌ Registration failed. Please try again.`;
      }
    }

    // ════════════════════════════════════════════════════
    // MEMBER LOGIN PATH
    // ════════════════════════════════════════════════════
    else if (session.state === 'member_phone') {
      session.data.lookup_phone = input || phoneNumber;
      session.state = 'member_menu';
      await setSession(sessionId, session);

      response = `CON What would you like to do?

1. Check Balance
2. Check Loan Status
3. Make Repayment
0. Back`;
    }

    else if (session.state === 'member_menu') {
      if (input === '1') {
        try {
          const balRes = await axios.get(`${DJANGO}/api/wallets/`, {
            params: { phone: session.data.lookup_phone || phoneNumber },
            headers: INTERNAL,
            timeout: 4000,
          });

          const wallet = balRes.data;
          await clearSession(sessionId);
          response = `END 💰 Kolliq Balance

Account: ${wallet.virtual_account_number ?? 'N/A'}
Balance: ₦${wallet.balance ?? '0.00'}

Dial back for more services.`;
        } catch {
          await clearSession(sessionId);
          response = `END Could not fetch balance. Try again.`;
        }
      }
      else if (input === '2') {
        await clearSession(sessionId);
        response = `END 📋 Loan Status

No active loan found.
Register to unlock loan services.`;
      }
      else if (input === '3') {
        await clearSession(sessionId);
        response = `END Loan repayment coming soon. Dial back later.`;
      }
      else if (input === '0') {
        await clearSession(sessionId);
        response = `END Goodbye!`;
      }
      else {
        await clearSession(sessionId);
        response = `END Invalid option. Please try again.`;
      }
    }

    // ════════════════════════════════════════════════════
    // FALLBACK
    // ════════════════════════════════════════════════════
    else {
      await clearSession(sessionId);
      response = `END Session error. Please dial again.`;
    }

  } catch (err) {
    console.error('USSD error:', err.message);
    await clearSession(sessionId);
    response = `END Something went wrong. Please try again.`;
  }

  res.set('Content-Type', 'text/plain');
  res.send(response);
}
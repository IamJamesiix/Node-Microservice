import { getSession, setSession, clearSession } from '../services/ussdSessionService.js';
import { requestOTP, verifyOTP } from '../services/otpService.js';
import { sendSMS } from '../services/smsService.js';
import axios from 'axios';
import config from '../config/dotenv.js';

const DJANGO = config.DJANGO_API_URL;

export async function handleUSSD(req, res) {
  const { sessionId, serviceCode, phoneNumber, text } = req.body;

  const parts = text ? text.split('*') : [];
  const input = parts[parts.length - 1];
  const depth = parts.filter(Boolean).length;

  let session = await getSession(sessionId);
  let response = '';

  try {
    // ── STATE 0: Welcome screen ──────────────────────────────
    if (!text || text === '') {
      session = { state: 0, path: null, data: { phone: phoneNumber } };
      await setSession(sessionId, session);

      response = `CON Welcome to Kolliq 🌟
Your economic identity platform.

1. Sell goods
2. Look for work
3. Member login
0. Exit`;
    }

    // ── STATE 0 → route by choice ────────────────────────────
    else if (depth === 1 && session.state === 0) {
      if (input === '1') {
        session.state = 1;
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
        session.state = 2;
        session.path = 'worker';
        await requestOTP(phoneNumber);
        await setSession(sessionId, session);
        response = `CON We sent a code to ${phoneNumber}.
Enter the 6-digit OTP:`;
      }
      else if (input === '3') {
        session.state = 3;
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

    // ── STATE 1: TRADER PATH ─────────────────────────────────
    // Step 1.1 — Category selected, ask market
    else if (depth === 2 && session.path === 'trader') {
      const categories = {
        '1': 'Food & Provisions',
        '2': 'Clothing & Fashion',
        '3': 'Electronics',
        '4': 'Building Materials',
        '5': 'Other',
      };
      session.data.category = categories[input] || 'Other';
      session.state = 1.2;
      await setSession(sessionId, session);

      response = `CON Which market do you trade in?

1. Balogun Market (Lagos)
2. Alaba Market (Lagos)
3. Wuse Market (Abuja)
4. Onitsha Main Market
5. Other`;
    }

    // Step 1.2 — Market selected, ask income range
    else if (depth === 3 && session.path === 'trader') {
      const markets = {
        '1': 'Balogun Market',
        '2': 'Alaba Market',
        '3': 'Wuse Market',
        '4': 'Onitsha Main Market',
        '5': 'Other',
      };
      session.data.market = markets[input] || 'Other';
      session.state = 1.3;
      await setSession(sessionId, session);

      response = `CON What is your monthly income range?

1. Below ₦50,000
2. ₦50,000 - ₦150,000
3. ₦150,000 - ₦500,000
4. Above ₦500,000`;
    }

    // Step 1.3 — Income selected, register trader
    else if (depth === 4 && session.path === 'trader') {
      const incomeRanges = {
        '1': '0-50000',
        '2': '50000-150000',
        '3': '150000-500000',
        '4': '500000+',
      };
      session.data.income_range = incomeRanges[input] || '0-50000';

      // Call Django to create user
      try {
        const djangoRes = await axios.post(`${DJANGO}/api/users/create/`, {
          phone: phoneNumber,
          user_type: 'trader',
          category: session.data.category,
          market: session.data.market,
          income_range: session.data.income_range,
        }, {
          headers: { 'X-Internal-Secret': config.DJANGO_API_SECRET },
          timeout: 5000,
        });

        const user = djangoRes.data;
        const accountNumber = user.virtual_account_number || 'Pending';
        const bankName = user.bank_name || 'Kolliq MFB';

        // Follow-up SMS with wallet details
        await sendSMS(
          phoneNumber,
          `✅ Kolliq: Registration successful!\nYour wallet: ${accountNumber}\nBank: ${bankName}\nDial back to check balance or apply for services.`
        );

        await clearSession(sessionId);
        response = `END ✅ Registration complete!

Your Kolliq wallet:
${accountNumber}
Bank: ${bankName}

Check your SMS for details.`;
      } catch (err) {
        await clearSession(sessionId);
        response = `END ❌ Registration failed: ${err.message}. Please try again.`;
      }
    }

    // ── STATE 2: WORKER PATH (OTP) ───────────────────────────
    else if (depth === 2 && session.path === 'worker') {
      const otp = input;

      try {
        await verifyOTP(phoneNumber, otp);

        const djangoRes = await axios.post(`${DJANGO}/api/users/create/`, {
          phone: phoneNumber,
          user_type: 'worker',
        }, {
          headers: { 'X-Internal-Secret': config.DJANGO_API_SECRET },
          timeout: 5000,
        });

        const user = djangoRes.data;
        const accountNumber = user.virtual_account_number || 'Pending';
        const bankName = user.bank_name || 'Kolliq MFB';

        // Follow-up SMS
        await sendSMS(
          phoneNumber,
          `✅ Kolliq: Welcome! Your wallet: ${accountNumber} (${bankName}). You can now receive payments for gigs. Dial back to check your balance.`
        );

        await clearSession(sessionId);
        response = `END ✅ Verified! Welcome to Kolliq.

Your wallet:
${accountNumber}
Bank: ${bankName}

SMS confirmation sent.`;
      } catch (err) {
        await clearSession(sessionId);
        response = `END ❌ ${err.message}. Please try again.`;
      }
    }

    // ── STATE 3: MEMBER LOGIN ────────────────────────────────
    // Step 3.1 — phone entered, show member menu
    else if (depth === 2 && session.path === 'member') {
      session.data.lookup_phone = input || phoneNumber;
      session.state = 3.1;
      await setSession(sessionId, session);

      response = `CON What would you like to do?

1. Check Balance
2. Check Loan Status
3. Make Repayment
0. Back`;
    }

    // Step 3.2 — member action
    else if (depth === 3 && session.path === 'member') {
      if (input === '1') {
        // Balance check → Django
        try {
          const balRes = await axios.get(`${DJANGO}/api/wallets/`, {
            params: { phone: session.data.lookup_phone || phoneNumber },
            headers: { 'X-Internal-Secret': config.DJANGO_API_SECRET },
            timeout: 4000,
          });

          const wallet = balRes.data;
          const balance = wallet.balance ?? '0.00';
          const acct = wallet.virtual_account_number ?? 'N/A';

          await clearSession(sessionId);
          response = `END 💰 Kolliq Balance

Account: ${acct}
Balance: ₦${balance}

Dial back for more services.`;
        } catch (err) {
          await clearSession(sessionId);
          response = `END Could not fetch balance. Please try again.`;
        }
      }
      else if (input === '2') {
        // Loan status stub — Django Day 3
        await clearSession(sessionId);
        response = `END 📋 Loan Status

No active loan found.
Dial back and register to unlock loan services.`;
      }
      else if (input === '3') {
        // Repayment stub — Django Day 3
        await clearSession(sessionId);
        response = `END Loan repayment will be available soon. Dial back later.`;
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

    // ── FALLBACK ─────────────────────────────────────────────
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
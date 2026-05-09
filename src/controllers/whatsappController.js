import Groq from 'groq-sdk';
import twilio from 'twilio';
import redis from '../config/redis.js';
import axios from 'axios';
import { sendSMS } from '../services/smsService.js';
import config from '../config/dotenv.js';

const groq = new Groq({ apiKey: config.GROQ_API_KEY });

const twilioClient = twilio(
  config.TWILIO_ACCOUNT_SID,
  config.TWILIO_AUTH_TOKEN
);

const SESSION_TTL = 60 * 30; // 30 min
const DJANGO = config.DJANGO_API_URL;
const INTERNAL = { 'X-Internal-Secret': config.DJANGO_API_SECRET };

// ── Session helpers ──────────────────────────────────────────
async function getWASession(phone) {
  try {
    const raw = await redis.get(`wa:${phone}`);
    return raw ? JSON.parse(raw) : { step: 'idle', data: {} };
  } catch {
    return { step: 'idle', data: {} };
  }
}

async function setWASession(phone, session) {
  await redis.set(`wa:${phone}`, JSON.stringify(session), 'EX', SESSION_TTL);
}

async function clearWASession(phone) {
  await redis.del(`wa:${phone}`);
}

// ── TwiML reply (inbound webhook response) ───────────────────
function twimlReply(res, message) {
  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${message}</Message>
</Response>`);
}

// ── Outbound WhatsApp via Twilio (not TwiML) ─────────────────
export async function sendWhatsApp(to, message) {
  return twilioClient.messages.create({
    from: config.TWILIO_WHATSAPP_NUMBER,
    to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
    body: message,
  });
}

// ── Intent detection ─────────────────────────────────────────
async function detectIntent(text, userType = 'any') {
  if (!text) return 'unknown';

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `You are an intent classifier for Kolliq, a Nigerian fintech platform.
Classify the user message into exactly ONE intent from this list:

EMPLOYER intents: post_job, confirm_done, check_status
WORKER intents: find_work, accept_job, check_score, apply_loan, check_balance
FINANCIAL intents: savings_deposit, savings_withdraw, insurance_activate, insurance_claim, loan_prepay
GENERAL: help, unknown

Support Nigerian Pidgin English naturally. Examples:
- "I need a rider in Surulere" → post_job
- "The work don finish" → confirm_done
- "I wan find work" / "Get me a job" → find_work
- "Wetin be my score?" / "Check my score" → check_score
- "I wan save money" / "Put 5k for savings" → savings_deposit
- "I wan withdraw" → savings_withdraw
- "I wan take loan" / "Apply loan for me" → apply_loan
- "Pay back loan" / "Loan repayment" → loan_prepay
- "Activate insurance" / "I wan insure" → insurance_activate
- "I wan claim insurance" → insurance_claim
- "My balance" / "How much I get?" → check_balance
- "Accept job" / "I go do am" → accept_job

Reply with ONLY the intent word. Nothing else.`,
        },
        { role: 'user', content: text },
      ],
      max_tokens: 15,
    });

    return completion.choices[0]?.message?.content?.trim().toLowerCase() || 'unknown';
  } catch (err) {
    console.error('Groq intent error:', err.message);
    // Fallback keyword detection so bot never fully breaks
    return keywordFallback(text);
  }
}

function keywordFallback(text) {
  const t = text?.toLowerCase() || '';
  if (t.includes('job') && (t.includes('need') || t.includes('want') || t.includes('post'))) return 'post_job';
  if (t.includes('done') || t.includes('finish') || t.includes('complete')) return 'confirm_done';
  if (t.includes('find work') || t.includes('wan work') || t.includes('find job')) return 'find_work';
  if (t.includes('score')) return 'check_score';
  if (t.includes('balance') || t.includes('how much')) return 'check_balance';
  if (t.includes('loan') && t.includes('apply')) return 'apply_loan';
  if (t.includes('save') || t.includes('savings') || t.includes('deposit')) return 'savings_deposit';
  if (t.includes('withdraw')) return 'savings_withdraw';
  if (t.includes('insurance') && t.includes('claim')) return 'insurance_claim';
  if (t.includes('insurance')) return 'insurance_activate';
  if (t.includes('prepay') || t.includes('pay back') || t.includes('repay')) return 'loan_prepay';
  return 'unknown';
}

// ── Django helpers ───────────────────────────────────────────
async function djangoGet(path, params = {}) {
  const res = await axios.get(`${DJANGO}${path}`, {
    params,
    headers: INTERNAL,
    timeout: 5000,
  });
  return res.data;
}

async function djangoPost(path, body = {}) {
  const res = await axios.post(`${DJANGO}${path}`, body, {
    headers: INTERNAL,
    timeout: 8000,
  });
  return res.data;
}

// ── Main handler ─────────────────────────────────────────────
export async function handleWhatsApp(req, res) {
  const { Body, From } = req.body;
  const phone = From; // whatsapp:+2348012345678
  const phoneClean = phone.replace('whatsapp:', '');

  console.log(`📱 WhatsApp [${phoneClean}]: ${Body}`);

  const session = await getWASession(phone);

  try {

    // ════════════════════════════════════════════════════════
    // IDLE — detect intent and route
    // ════════════════════════════════════════════════════════
    if (session.step === 'idle') {
      const intent = await detectIntent(Body);
      console.log(`🎯 Intent: ${intent}`);

      // ── EMPLOYER: Post Job ─────────────────────────────
      if (intent === 'post_job') {
        await setWASession(phone, { step: 'job_collect_skill', data: {} });
        return twimlReply(res,
          `👷 Let's post a job on Kolliq!\n\nWhat skill do you need?\n(e.g. Rider, Carpenter, Cleaner, Security Guard, Electrician)`
        );
      }

      // ── EMPLOYER: Confirm Done ─────────────────────────
      if (intent === 'confirm_done') {
        await setWASession(phone, { step: 'job_confirm_id', data: {} });
        return twimlReply(res, `✅ To confirm job completion, send me your Job ID:`);
      }

      // ── EMPLOYER: Check Status ─────────────────────────
      if (intent === 'check_status') {
        await setWASession(phone, { step: 'job_status_id', data: {} });
        return twimlReply(res, `📋 Send me your Job ID to check status:`);
      }

      // ── WORKER: Find Work ──────────────────────────────
      if (intent === 'find_work') {
        try {
          const jobs = await djangoGet('/api/jobs/fixed/', { phone: phoneClean });

          if (!jobs || jobs.length === 0) {
            return twimlReply(res,
              `😔 No matching jobs right now.\n\nWe'll SMS you when a job matches your profile.\nMake sure your profile is complete — dial *347*1234# to update.`
            );
          }

          const list = jobs.slice(0, 3).map((j, i) =>
            `${i + 1}. ${j.skill} in ${j.location}\n   Pay: ₦${j.pay_per_worker} | Time: ${j.scheduled_time}\n   Job ID: ${j.id}`
          ).join('\n\n');

          await setWASession(phone, { step: 'job_accept_choice', data: { jobs: jobs.slice(0, 3) } });

          return twimlReply(res,
            `🔍 Top jobs for you:\n\n${list}\n\nReply 1, 2, or 3 to accept a job.\nReply 0 to cancel.`
          );
        } catch (err) {
          return twimlReply(res, `Could not fetch jobs right now. Try again in a moment.`);
        }
      }

      // ── WORKER: Accept Job (direct intent) ────────────
      if (intent === 'accept_job') {
        await setWASession(phone, { step: 'job_accept_id', data: {} });
        return twimlReply(res, `Send me the Job ID you want to accept:`);
      }

      // ── WORKER: Check Score ────────────────────────────
      if (intent === 'check_score') {
        try {
          const wallet = await djangoGet('/api/wallets/', { phone: phoneClean });
          const score = wallet.eis_score ?? 0;
          const balance = wallet.balance ?? '0.00';

          let unlocked = '❌ No services unlocked yet';
          if (score >= 30) unlocked = '✅ Basic savings unlocked';
          if (score >= 50) unlocked = '✅ Savings + Loan eligibility unlocked';
          if (score >= 70) unlocked = '✅ Savings + Loans + Insurance unlocked';

          return twimlReply(res,
            `📊 *Your Kolliq Profile*\n\n` +
            `Score: ${score}/100\n` +
            `Balance: ₦${balance}\n` +
            `Status: ${unlocked}\n\n` +
            `Keep completing gigs to raise your score! 🔥\n` +
            `Reply "apply loan" or "activate insurance" when ready.`
          );
        } catch {
          return twimlReply(res, `Could not fetch your score. Please try again.`);
        }
      }

      // ── WORKER: Check Balance ──────────────────────────
      if (intent === 'check_balance') {
        try {
          const wallet = await djangoGet('/api/wallets/', { phone: phoneClean });
          return twimlReply(res,
            `💰 *Kolliq Balance*\n\n` +
            `Account: ${wallet.virtual_account_number ?? 'N/A'}\n` +
            `Balance: ₦${wallet.balance ?? '0.00'}\n` +
            `Score: ${wallet.eis_score ?? 0}/100\n\n` +
            `Reply "find work" to see available jobs.`
          );
        } catch {
          return twimlReply(res, `Could not fetch balance. Try again.`);
        }
      }

      // ── FINANCIAL: Savings Deposit ─────────────────────
      if (intent === 'savings_deposit') {
        await setWASession(phone, { step: 'savings_deposit_amount', data: {} });
        return twimlReply(res,
          `💳 *Savings Deposit*\n\nHow much do you want to save? (in ₦)\n(Minimum: ₦500)`
        );
      }

      // ── FINANCIAL: Savings Withdraw ────────────────────
      if (intent === 'savings_withdraw') {
        await setWASession(phone, { step: 'savings_withdraw_amount', data: {} });
        return twimlReply(res,
          `💸 *Savings Withdrawal*\n\nHow much do you want to withdraw? (in ₦)`
        );
      }

      // ── FINANCIAL: Apply Loan ──────────────────────────
      if (intent === 'apply_loan') {
        try {
          const eligibility = await djangoGet('/api/financial/loans/eligibility/', { phone: phoneClean });

          if (!eligibility.eligible) {
            return twimlReply(res,
              `❌ *Loan Not Available Yet*\n\n` +
              `Your score: ${eligibility.score ?? 0}/100\n` +
              `Required: 50+\n\n` +
              `Complete more gigs to raise your score and unlock loans! 💪`
            );
          }

          const limit = eligibility.loan_limit ?? 0;
          await setWASession(phone, { step: 'loan_apply_amount', data: { limit, score: eligibility.score } });

          return twimlReply(res,
            `✅ *You're Eligible for a Loan!*\n\n` +
            `Score: ${eligibility.score}/100\n` +
            `Max loan: ₦${limit.toLocaleString()}\n` +
            `Rate: 5% flat\n` +
            `Repayment: Weekly (auto-deducted Mondays)\n\n` +
            `How much do you want to borrow? (in ₦)`
          );
        } catch (err) {
          return twimlReply(res, `Could not check eligibility right now. Try again.`);
        }
      }

      // ── FINANCIAL: Loan Prepay ─────────────────────────
      if (intent === 'loan_prepay') {
        await setWASession(phone, { step: 'loan_prepay_amount', data: {} });
        return twimlReply(res,
          `💰 *Loan Repayment*\n\nHow much do you want to repay early? (in ₦)`
        );
      }

      // ── FINANCIAL: Insurance Activate ──────────────────
      if (intent === 'insurance_activate') {
        try {
          const wallet = await djangoGet('/api/wallets/', { phone: phoneClean });
          const score = wallet.eis_score ?? 0;

          if (score < 70) {
            return twimlReply(res,
              `❌ *Insurance Not Available Yet*\n\n` +
              `Your score: ${score}/100\n` +
              `Required: 70+\n\n` +
              `Keep working to unlock insurance! 💪`
            );
          }

          await setWASession(phone, { step: 'insurance_confirm', data: {} });
          return twimlReply(res,
            `🛡️ *Income Protection Insurance*\n\n` +
            `Premium: ₦200/day (auto-deducted)\n` +
            `Coverage: Up to ₦5,000 auto-approved claims\n` +
            `Larger claims: Manual review within 48hrs\n\n` +
            `Reply YES to activate or NO to cancel.`
          );
        } catch {
          return twimlReply(res, `Could not check eligibility. Try again.`);
        }
      }

      // ── FINANCIAL: Insurance Claim ─────────────────────
      if (intent === 'insurance_claim') {
        await setWASession(phone, { step: 'insurance_claim_amount', data: {} });
        return twimlReply(res,
          `🏥 *Insurance Claim*\n\nHow much are you claiming? (in ₦)\nClaims up to ₦5,000 are auto-approved.`
        );
      }

      // ── HELP / UNKNOWN ─────────────────────────────────
      return twimlReply(res,
        `👋 *Welcome to Kolliq!*\n\n` +
        `*Employers:*\n• "Post a job"\n• "Job done [ID]"\n• "Check status [ID]"\n\n` +
        `*Workers:*\n• "Find me work"\n• "Check my score"\n• "My balance"\n• "Apply loan"\n• "Save money"\n• "Activate insurance"\n\n` +
        `We understand Pidgin too 😄\nWhat do you need?`
      );
    }

    // ════════════════════════════════════════════════════════
    // MULTI-TURN: JOB POSTING FLOW
    // ════════════════════════════════════════════════════════

    else if (session.step === 'job_collect_skill') {
      session.data.skill = Body.trim();
      session.step = 'job_collect_workers';
      await setWASession(phone, session);
      return twimlReply(res, `How many workers do you need?`);
    }

    else if (session.step === 'job_collect_workers') {
      session.data.workers = parseInt(Body.trim()) || 1;
      session.step = 'job_collect_pay';
      await setWASession(phone, session);
      return twimlReply(res, `How much will you pay per worker? (in ₦)\ne.g. 5000`);
    }

    else if (session.step === 'job_collect_pay') {
      session.data.pay_per_worker = parseInt(Body.replace(/[^0-9]/g, '')) || 0;
      session.step = 'job_collect_time';
      await setWASession(phone, session);
      return twimlReply(res, `What time and date do you need them?\ne.g. Tomorrow 8am, Monday 9am`);
    }

    else if (session.step === 'job_collect_time') {
      session.data.time = Body.trim();
      session.step = 'job_collect_area';
      await setWASession(phone, session);
      return twimlReply(res, `Which area or location?\ne.g. Surulere, Ikeja, Lagos Island`);
    }

    else if (session.step === 'job_collect_area') {
      session.data.area = Body.trim();

      try {
        const job = await djangoPost('/api/jobs/create/', {
          employer_phone: phoneClean,
          skill: session.data.skill,
          workers_needed: session.data.workers,
          pay_per_worker: session.data.pay_per_worker,
          scheduled_time: session.data.time,
          location: session.data.area,
        });

        const total = session.data.pay_per_worker * session.data.workers;

        await clearWASession(phone);
        return twimlReply(res,
          `✅ *Job Posted!*\n\n` +
          `🔑 Job ID: ${job.id}\n` +
          `👷 Skill: ${session.data.skill}\n` +
          `👥 Workers: ${session.data.workers}\n` +
          `💰 Pay: ₦${session.data.pay_per_worker} each\n` +
          `📍 Area: ${session.data.area}\n` +
          `🕐 Time: ${session.data.time}\n\n` +
          `*Pay escrow to confirm:*\n` +
          `Bank: ${job.escrow_bank || 'Squad MFB'}\n` +
          `Account: ${job.escrow_account_number}\n` +
          `Amount: ₦${total.toLocaleString()}\n` +
          `Narration: JOB-${job.id}\n\n` +
          `Workers matched once payment confirmed. 🔥`
        );
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Job creation failed: ${err.message}. Please try again.`);
      }
    }

    // ── Job confirm done ───────────────────────────────────
    else if (session.step === 'job_confirm_id') {
      const jobId = Body.trim();
      try {
        await djangoPost('/api/jobs/complete/', {
          job_id: jobId,
          employer_phone: phoneClean,
        });
        await clearWASession(phone);
        return twimlReply(res,
          `✅ Job *${jobId}* confirmed complete!\nWorker payment released. Thank you for using Kolliq! 🔥`
        );
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Could not confirm: ${err.message}. Check Job ID and try again.`);
      }
    }

    // ── Job status check ───────────────────────────────────
    else if (session.step === 'job_status_id') {
      const jobId = Body.trim();
      try {
        const job = await djangoGet(`/api/jobs/${jobId}/`);
        await clearWASession(phone);
        return twimlReply(res,
          `📋 *Job ${jobId} Status*\n\n` +
          `Status: ${job.status ?? 'Unknown'}\n` +
          `Skill: ${job.skill}\n` +
          `Workers: ${job.workers_needed}\n` +
          `Location: ${job.location}\n` +
          `Time: ${job.scheduled_time}`
        );
      } catch {
        await clearWASession(phone);
        return twimlReply(res, `Job not found. Check your Job ID and try again.`);
      }
    }

    // ════════════════════════════════════════════════════════
    // MULTI-TURN: WORKER ACCEPT JOB (from find_work list)
    // ════════════════════════════════════════════════════════

    else if (session.step === 'job_accept_choice') {
      const choice = parseInt(Body.trim());
      if (choice === 0) {
        await clearWASession(phone);
        return twimlReply(res, `No problem! We'll notify you when new jobs come in. 💪`);
      }

      const jobs = session.data.jobs || [];
      const selected = jobs[choice - 1];

      if (!selected) {
        return twimlReply(res, `Invalid choice. Reply 1, 2, or 3 to accept, or 0 to cancel.`);
      }

      try {
        await djangoPost('/api/jobs/accept/', {
          job_id: selected.id,
          worker_phone: phoneClean,
        });

        await clearWASession(phone);
        return twimlReply(res,
          `🎉 *Job Accepted!*\n\n` +
          `${selected.skill} in ${selected.location}\n` +
          `Pay: ₦${selected.pay_per_worker}\n` +
          `Time: ${selected.scheduled_time}\n` +
          `Job ID: ${selected.id}\n\n` +
          `The employer has been notified. Be on time! 💪`
        );
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Could not accept job: ${err.message}. Try again.`);
      }
    }

    else if (session.step === 'job_accept_id') {
      const jobId = Body.trim();
      try {
        await djangoPost('/api/jobs/accept/', {
          job_id: jobId,
          worker_phone: phoneClean,
        });
        await clearWASession(phone);
        return twimlReply(res,
          `🎉 Job *${jobId}* accepted!\nEmployer notified. Good luck! 💪`
        );
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Could not accept: ${err.message}.`);
      }
    }

    // ════════════════════════════════════════════════════════
    // MULTI-TURN: FINANCIAL SERVICES
    // ════════════════════════════════════════════════════════

    // ── Savings Deposit ────────────────────────────────────
    else if (session.step === 'savings_deposit_amount') {
      const amount = parseInt(Body.replace(/[^0-9]/g, ''));
      if (!amount || amount < 500) {
        return twimlReply(res, `Minimum deposit is ₦500. Enter a valid amount:`);
      }
      try {
        const result = await djangoPost('/api/financial/savings/deposit/', {
          phone: phoneClean,
          amount,
        });
        await clearWASession(phone);
        return twimlReply(res,
          `✅ *Savings Deposit Successful!*\n\n` +
          `Deposited: ₦${amount.toLocaleString()}\n` +
          `Savings Balance: ₦${result.savings_balance ?? amount}\n` +
          `Interest Rate: 5% p.a. (accrues daily)\n\n` +
          `Reply "my balance" to check total balance.`
        );
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Deposit failed: ${err.message}. Try again.`);
      }
    }

    // ── Savings Withdraw ───────────────────────────────────
    else if (session.step === 'savings_withdraw_amount') {
      const amount = parseInt(Body.replace(/[^0-9]/g, ''));
      if (!amount) {
        return twimlReply(res, `Enter a valid amount to withdraw:`);
      }
      try {
        const result = await djangoPost('/api/financial/savings/withdraw/', {
          phone: phoneClean,
          amount,
        });
        await clearWASession(phone);
        return twimlReply(res,
          `✅ *Withdrawal Successful!*\n\n` +
          `Withdrawn: ₦${amount.toLocaleString()}\n` +
          `Remaining Savings: ₦${result.savings_balance ?? 0}\n\n` +
          `Funds added to your wallet.`
        );
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Withdrawal failed: ${err.message}. Check your savings balance.`);
      }
    }

    // ── Loan Apply ─────────────────────────────────────────
    else if (session.step === 'loan_apply_amount') {
      const amount = parseInt(Body.replace(/[^0-9]/g, ''));
      const limit = session.data.limit ?? 0;

      if (!amount) {
        return twimlReply(res, `Enter a valid amount in ₦:`);
      }
      if (amount > limit) {
        return twimlReply(res, `❌ Amount exceeds your limit of ₦${limit.toLocaleString()}.\nEnter a lower amount:`);
      }

      try {
        const result = await djangoPost('/api/financial/loans/apply/', {
          phone: phoneClean,
          amount,
        });
        await clearWASession(phone);

        const repayment = Math.ceil(amount * 1.05);
        return twimlReply(res,
          `✅ *Loan Approved!*\n\n` +
          `Amount: ₦${amount.toLocaleString()}\n` +
          `Fee (5%): ₦${(amount * 0.05).toLocaleString()}\n` +
          `Total Repayment: ₦${repayment.toLocaleString()}\n` +
          `Schedule: Weekly auto-deduct (Mondays)\n\n` +
          `Funds disbursed to your Kolliq wallet. 💰\n` +
          `Ref: ${result.reference ?? 'N/A'}`
        );
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Loan failed: ${err.message}.`);
      }
    }

    // ── Loan Prepay ────────────────────────────────────────
    else if (session.step === 'loan_prepay_amount') {
      const amount = parseInt(Body.replace(/[^0-9]/g, ''));
      if (!amount) {
        return twimlReply(res, `Enter a valid repayment amount in ₦:`);
      }
      try {
        const result = await djangoPost('/api/financial/loans/prepay/', {
          phone: phoneClean,
          amount,
        });
        await clearWASession(phone);
        return twimlReply(res,
          `✅ *Loan Repayment Successful!*\n\n` +
          `Paid: ₦${amount.toLocaleString()}\n` +
          `Remaining Balance: ₦${result.remaining_balance ?? 0}\n\n` +
          `Early repayment improves your Kolliq Score! 📈`
        );
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Repayment failed: ${err.message}.`);
      }
    }

    // ── Insurance Activate Confirm ─────────────────────────
    else if (session.step === 'insurance_confirm') {
      const answer = Body.trim().toLowerCase();
      if (answer === 'yes' || answer === 'y') {
        try {
          await djangoPost('/api/financial/insurance/activate/', { phone: phoneClean });
          await clearWASession(phone);
          return twimlReply(res,
            `✅ *Insurance Activated!*\n\n` +
            `🛡️ Income Protection Insurance\n` +
            `Premium: ₦200/day\n` +
            `Coverage active immediately\n\n` +
            `Reply "claim insurance" if you need to file a claim.`
          );
        } catch (err) {
          await clearWASession(phone);
          return twimlReply(res, `❌ Activation failed: ${err.message}.`);
        }
      } else {
        await clearWASession(phone);
        return twimlReply(res, `Insurance activation cancelled. Reply anytime to activate.`);
      }
    }

    // ── Insurance Claim ────────────────────────────────────
    else if (session.step === 'insurance_claim_amount') {
      const amount = parseInt(Body.replace(/[^0-9]/g, ''));
      if (!amount) {
        return twimlReply(res, `Enter a valid claim amount in ₦:`);
      }
      try {
        const result = await djangoPost('/api/financial/insurance/claim/', {
          phone: phoneClean,
          amount,
        });
        await clearWASession(phone);

        if (result.status === 'approved') {
          return twimlReply(res,
            `✅ *Claim Approved!*\n\n` +
            `Amount: ₦${amount.toLocaleString()}\n` +
            `Status: Auto-approved\n` +
            `Funds added to your wallet immediately.\n` +
            `Ref: ${result.reference ?? 'N/A'}`
          );
        } else {
          return twimlReply(res,
            `📋 *Claim Under Review*\n\n` +
            `Amount: ₦${amount.toLocaleString()}\n` +
            `Status: Manual review (48hrs)\n` +
            `Ref: ${result.reference ?? 'N/A'}\n\n` +
            `We'll notify you via SMS when resolved.`
          );
        }
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Claim failed: ${err.message}.`);
      }
    }

    // ── Fallback for any broken session ───────────────────
    else {
      await clearWASession(phone);
      return twimlReply(res,
        `Session expired. Please start over.\n\nReply "help" to see what I can do.`
      );
    }

  } catch (err) {
    console.error('WhatsApp handler error:', err.message);
    await clearWASession(phone);
    return twimlReply(res, `Something went wrong. Please try again.`);
  }
}
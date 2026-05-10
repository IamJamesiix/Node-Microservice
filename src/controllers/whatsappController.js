import Groq from 'groq-sdk';
import twilio from 'twilio';
import redis from '../config/redis.js';
import axios from 'axios';
import { sendSMS } from '../services/smsService.js';
import { queueFailedCall } from '../services/retryQueue.js';
import config from '../config/dotenv.js';

const groq = new Groq({ apiKey: config.GROQ_API_KEY });
const twilioClient = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);

const SESSION_TTL = 60 * 30;
const DJANGO = config.DJANGO_API_URL;
const INTERNAL = { 'X-Internal-Secret': config.DJANGO_API_SECRET };

// ── Helpers ──────────────────────────────────────────────────
async function getWASession(phone) {
  try {
    const raw = await redis.get(`wa:${phone}`);
    return raw ? JSON.parse(raw) : { step: 'idle', data: {} };
  } catch { return { step: 'idle', data: {} }; }
}

async function setWASession(phone, session) {
  await redis.set(`wa:${phone}`, JSON.stringify(session), 'EX', SESSION_TTL);
}

async function clearWASession(phone) {
  await redis.del(`wa:${phone}`);
}

function twimlReply(res, message) {
  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`);
}

export async function sendWhatsApp(to, message) {
  return twilioClient.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
    body: message,
  });
}

async function djangoGet(path, params = {}) {
  const res = await axios.get(`${DJANGO}${path}`, { params, headers: INTERNAL, timeout: 5000 });
  return res.data;
}

async function djangoPost(path, body = {}) {
  const res = await axios.post(`${DJANGO}${path}`, body, { headers: INTERNAL, timeout: 8000 });
  return res.data;
}

// ── Intent detection ─────────────────────────────────────────
async function detectIntent(text) {
  if (!text) return 'unknown';
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `You are an intent classifier for Kolliq, a Nigerian fintech platform.
Classify into exactly ONE intent:
post_job, confirm_done, cancel_job, check_status, find_work, accept_job,
check_score, check_balance, apply_loan, loan_prepay, savings_deposit,
savings_withdraw, insurance_activate, insurance_claim, help, unknown.

Nigerian Pidgin English supported. Edge cases:
- "I need two riders" → post_job
- "I need riders in Surulere" → post_job
- "cancel the job" / "cancel job" → cancel_job
- "how much did I earn" / "how much I make" → check_balance
- "I don finish the work" → confirm_done
- "abeg cancel am" → cancel_job
- Numbers of workers in request still means post_job

Reply with ONLY the intent word.`,
        },
        { role: 'user', content: text },
      ],
      max_tokens: 15,
    });
    return completion.choices[0]?.message?.content?.trim().toLowerCase() || keywordFallback(text);
  } catch (err) {
    console.error('Groq error:', err.message);
    return keywordFallback(text);
  }
}

function keywordFallback(text) {
  const t = (text || '').toLowerCase();
  if ((t.includes('need') || t.includes('want') || t.includes('post')) && (t.includes('rider') || t.includes('worker') || t.includes('job'))) return 'post_job';
  if (t.includes('cancel')) return 'cancel_job';
  if (t.includes('done') || t.includes('finish') || t.includes('complete')) return 'confirm_done';
  if (t.includes('find work') || t.includes('wan work') || t.includes('find job') || t.includes('get job')) return 'find_work';
  if (t.includes('score')) return 'check_score';
  if (t.includes('balance') || t.includes('how much') || t.includes('earn') || t.includes('make')) return 'check_balance';
  if (t.includes('loan') && (t.includes('apply') || t.includes('take') || t.includes('wan'))) return 'apply_loan';
  if (t.includes('repay') || t.includes('pay back') || t.includes('prepay')) return 'loan_prepay';
  if (t.includes('save') || t.includes('deposit') || t.includes('savings')) return 'savings_deposit';
  if (t.includes('withdraw')) return 'savings_withdraw';
  if (t.includes('insurance') && t.includes('claim')) return 'insurance_claim';
  if (t.includes('insurance')) return 'insurance_activate';
  if (t.includes('status')) return 'check_status';
  return 'unknown';
}

// ── Main handler ─────────────────────────────────────────────
export async function handleWhatsApp(req, res) {
  const { Body, From } = req.body;
  const phone = From;
  const phoneClean = phone.replace('whatsapp:', '');

  console.log(`📱 [${phoneClean}]: ${Body}`);
  const session = await getWASession(phone);

  try {

    // ════════════════════════════════════════════════════
    // IDLE
    // ════════════════════════════════════════════════════
    if (session.step === 'idle') {
      const intent = await detectIntent(Body);
      console.log(`🎯 Intent: ${intent}`);

      if (intent === 'post_job') {
        await setWASession(phone, { step: 'job_collect_skill', data: {} });
        return twimlReply(res, `👷 Let's post a job!\n\nWhat skill do you need?\n(e.g. Rider, Carpenter, Cleaner, Security Guard)`);
      }

      if (intent === 'confirm_done') {
        await setWASession(phone, { step: 'job_confirm_id', data: {} });
        return twimlReply(res, `✅ Send me your Job ID to confirm completion:`);
      }

      if (intent === 'cancel_job') {
        await setWASession(phone, { step: 'job_cancel_id', data: {} });
        return twimlReply(res, `❌ Send me the Job ID you want to cancel:`);
      }

      if (intent === 'check_status') {
        await setWASession(phone, { step: 'job_status_id', data: {} });
        return twimlReply(res, `📋 Send me your Job ID to check status:`);
      }

      if (intent === 'find_work') {
        try {
          const jobs = await djangoGet('/api/jobs/fixed/', { phone: phoneClean });
          if (!jobs || jobs.length === 0) {
            return twimlReply(res, `😔 No matching jobs right now.\n\nWe'll SMS you when a job matches your profile.\nMake sure your profile is complete — dial *347*1234# to update.`);
          }
          const list = jobs.slice(0, 3).map((j, i) =>
            `${i + 1}. ${j.skill} in ${j.location}\n   Pay: ₦${j.pay_per_worker} | ${j.scheduled_time}\n   ID: ${j.id}`
          ).join('\n\n');
          await setWASession(phone, { step: 'job_accept_choice', data: { jobs: jobs.slice(0, 3) } });
          return twimlReply(res, `🔍 Top jobs for you:\n\n${list}\n\nReply 1, 2, or 3 to accept. Reply 0 to cancel.`);
        } catch {
          return twimlReply(res, `Could not fetch jobs right now. Try again shortly.`);
        }
      }

      if (intent === 'accept_job') {
        await setWASession(phone, { step: 'job_accept_id', data: {} });
        return twimlReply(res, `Send me the Job ID you want to accept:`);
      }

      if (intent === 'check_score') {
        try {
          const wallet = await djangoGet('/api/wallets/', { phone: phoneClean });
          const score = wallet.eis_score ?? 0;
          const balance = wallet.balance ?? '0.00';
          let unlocked = '❌ No services unlocked yet (need 30+)';
          if (score >= 90) unlocked = '✅ All services unlocked';
          else if (score >= 70) unlocked = '✅ Savings + Loans + Insurance';
          else if (score >= 50) unlocked = '✅ Savings + Loan eligibility';
          else if (score >= 30) unlocked = '✅ Basic savings unlocked';
          return twimlReply(res, `📊 *Your Kolliq Profile*\n\nScore: ${score}/100\nBalance: ₦${balance}\nStatus: ${unlocked}\n\nComplete more gigs to level up! 🔥`);
        } catch {
          return twimlReply(res, `Could not fetch your score. Try again.`);
        }
      }

      if (intent === 'check_balance') {
        try {
          const wallet = await djangoGet('/api/wallets/', { phone: phoneClean });
          return twimlReply(res, `💰 *Kolliq Balance*\n\nAccount: ${wallet.virtual_account_number ?? 'N/A'}\nWallet: ₦${wallet.balance ?? '0.00'}\nSavings: ₦${wallet.savings_balance ?? '0.00'}\nScore: ${wallet.eis_score ?? 0}/100`);
        } catch {
          return twimlReply(res, `Could not fetch balance. Try again.`);
        }
      }

      if (intent === 'apply_loan') {
        try {
          const eligibility = await djangoGet('/api/financial/loans/eligibility/', { phone: phoneClean });
          if (!eligibility.eligible) {
            return twimlReply(res, `❌ *Loan Not Available*\n\nYour score: ${eligibility.score ?? 0}/100\nRequired: 50+\n\nComplete more gigs to unlock loans! 💪`);
          }
          await setWASession(phone, { step: 'loan_apply_amount', data: { limit: eligibility.loan_limit, score: eligibility.score } });
          return twimlReply(res, `✅ *You're Loan Eligible!*\n\nScore: ${eligibility.score}/100\nMax: ₦${(eligibility.loan_limit || 0).toLocaleString()}\nRate: 5% flat | Repayment: Weekly Mondays\n\nHow much do you want? (in ₦)`);
        } catch {
          return twimlReply(res, `Could not check eligibility right now. Try again.`);
        }
      }

      if (intent === 'loan_prepay') {
        await setWASession(phone, { step: 'loan_prepay_amount', data: {} });
        return twimlReply(res, `💰 *Loan Repayment*\n\nHow much do you want to pay back? (in ₦)`);
      }

      if (intent === 'savings_deposit') {
        await setWASession(phone, { step: 'savings_deposit_amount', data: {} });
        return twimlReply(res, `💳 *Savings Deposit*\n\nHow much do you want to save? (in ₦, min ₦500)`);
      }

      if (intent === 'savings_withdraw') {
        await setWASession(phone, { step: 'savings_withdraw_amount', data: {} });
        return twimlReply(res, `💸 *Savings Withdrawal*\n\nHow much do you want to withdraw? (in ₦)`);
      }

      if (intent === 'insurance_activate') {
        try {
          const wallet = await djangoGet('/api/wallets/', { phone: phoneClean });
          const score = wallet.eis_score ?? 0;
          if (score < 70) {
            return twimlReply(res, `❌ *Insurance Not Available*\n\nYour score: ${score}/100\nRequired: 70+\n\nKeep working to unlock insurance! 💪`);
          }
          await setWASession(phone, { step: 'insurance_confirm', data: {} });
          return twimlReply(res, `🛡️ *Income Protection Insurance*\n\nPremium: ₦200/day\nCoverage: Up to ₦5,000 auto-approved\nLarger claims: Manual review 48hrs\n\nReply YES to activate or NO to cancel.`);
        } catch {
          return twimlReply(res, `Could not check eligibility. Try again.`);
        }
      }

      if (intent === 'insurance_claim') {
        await setWASession(phone, { step: 'insurance_claim_amount', data: {} });
        return twimlReply(res, `🏥 *Insurance Claim*\n\nHow much are you claiming? (in ₦)\nClaims up to ₦5,000 are auto-approved.`);
      }

      // help / unknown
      return twimlReply(res,
        `👋 *Welcome to Kolliq!*\n\n` +
        `*Employers:*\n• "Post a job"\n• "Cancel job"\n• "Job done [ID]"\n\n` +
        `*Workers:*\n• "Find me work"\n• "Check my score"\n• "My balance"\n• "Apply loan"\n• "Save money"\n• "Activate insurance"\n\n` +
        `We understand Pidgin too 😄`
      );
    }

    // ════════════════════════════════════════════════════
    // JOB POSTING FLOW
    // ════════════════════════════════════════════════════
    else if (session.step === 'job_collect_skill') {
      session.data.skill = Body.trim();
      session.step = 'job_collect_workers';
      await setWASession(phone, session);
      return twimlReply(res, `How many workers do you need?`);
    }
    else if (session.step === 'job_collect_workers') {
      const n = parseInt(Body.trim());
      if (!n || n < 1) return twimlReply(res, `Please enter a valid number of workers (e.g. 1, 2, 5):`);
      session.data.workers = n;
      session.step = 'job_collect_pay';
      await setWASession(phone, session);
      return twimlReply(res, `How much will you pay per worker? (in ₦)\ne.g. 5000`);
    }
    else if (session.step === 'job_collect_pay') {
      const pay = parseInt(Body.replace(/[^0-9]/g, ''));
      if (!pay || pay < 100) return twimlReply(res, `Enter a valid pay amount (e.g. 5000):`);
      session.data.pay_per_worker = pay;
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
          `🔑 Job ID: ${job.id}\n👷 ${session.data.skill}\n👥 ${session.data.workers} worker(s)\n` +
          `💰 ₦${session.data.pay_per_worker} each | 📍 ${session.data.area}\n🕐 ${session.data.time}\n\n` +
          `*Pay escrow to confirm:*\nBank: ${job.escrow_bank || 'Squad MFB'}\nAccount: ${job.escrow_account_number}\n` +
          `Amount: ₦${total.toLocaleString()}\nNarration: JOB-${job.id}\n\nWorkers matched once payment confirmed. 🔥`
        );
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Job creation failed. Please try again.\n(${err.message})`);
      }
    }

    // ── Confirm done ───────────────────────────────────────
    else if (session.step === 'job_confirm_id') {
      try {
        await djangoPost('/api/jobs/complete/', { job_id: Body.trim(), employer_phone: phoneClean });
        await clearWASession(phone);
        return twimlReply(res, `✅ Job *${Body.trim()}* confirmed complete!\nWorker payment released. Thank you! 🔥`);
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Could not confirm: ${err.message}. Check your Job ID.`);
      }
    }

    // ── Cancel job ─────────────────────────────────────────
    else if (session.step === 'job_cancel_id') {
      try {
        await djangoPost('/api/jobs/cancel/', { job_id: Body.trim(), employer_phone: phoneClean });
        await clearWASession(phone);
        return twimlReply(res, `✅ Job *${Body.trim()}* cancelled.\nIf escrow was paid, refund will process within 24hrs.`);
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Could not cancel: ${err.message}. Check your Job ID.`);
      }
    }

    // ── Check status ───────────────────────────────────────
    else if (session.step === 'job_status_id') {
      try {
        const job = await djangoGet(`/api/jobs/${Body.trim()}/`);
        await clearWASession(phone);
        return twimlReply(res,
          `📋 *Job ${Body.trim()} Status*\n\n` +
          `Status: ${job.status}\nSkill: ${job.skill}\nLocation: ${job.location}\nTime: ${job.scheduled_time}\nWorkers: ${job.workers_needed}`
        );
      } catch {
        await clearWASession(phone);
        return twimlReply(res, `Job not found. Double-check your Job ID.`);
      }
    }

    // ── Worker: pick from list ─────────────────────────────
    else if (session.step === 'job_accept_choice') {
      const choice = parseInt(Body.trim());
      if (choice === 0) {
        await clearWASession(phone);
        return twimlReply(res, `No problem! We'll notify you when new jobs match. 💪`);
      }
      const jobs = session.data.jobs || [];
      const selected = jobs[choice - 1];
      if (!selected) return twimlReply(res, `Invalid choice. Reply 1, 2, or 3 to accept, or 0 to cancel.`);
      try {
        await djangoPost('/api/jobs/accept/', { job_id: selected.id, worker_phone: phoneClean });
        await clearWASession(phone);
        return twimlReply(res,
          `🎉 *Job Accepted!*\n\n${selected.skill} in ${selected.location}\nPay: ₦${selected.pay_per_worker}\nTime: ${selected.scheduled_time}\nJob ID: ${selected.id}\n\nEmployer notified. Be on time! 💪`
        );
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Could not accept: ${err.message}.`);
      }
    }

    // ── Worker: accept by ID ───────────────────────────────
    else if (session.step === 'job_accept_id') {
      try {
        await djangoPost('/api/jobs/accept/', { job_id: Body.trim(), worker_phone: phoneClean });
        await clearWASession(phone);
        return twimlReply(res, `🎉 Job *${Body.trim()}* accepted! Employer notified. Good luck! 💪`);
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Could not accept: ${err.message}.`);
      }
    }

    // ════════════════════════════════════════════════════
    // FINANCIAL FLOWS
    // ════════════════════════════════════════════════════
    else if (session.step === 'savings_deposit_amount') {
      const amount = parseInt(Body.replace(/[^0-9]/g, ''));
      if (!amount || amount < 500) return twimlReply(res, `Minimum deposit is ₦500. Enter a valid amount:`);
      try {
        const result = await djangoPost('/api/financial/savings/deposit/', { phone: phoneClean, amount });
        await clearWASession(phone);
        return twimlReply(res, `✅ *Deposit Successful!*\n\nSaved: ₦${amount.toLocaleString()}\nSavings Balance: ₦${result.savings_balance ?? amount}\nInterest: 5% p.a. (daily accrual) 📈`);
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Deposit failed: ${err.message}.`);
      }
    }

    else if (session.step === 'savings_withdraw_amount') {
      const amount = parseInt(Body.replace(/[^0-9]/g, ''));
      if (!amount) return twimlReply(res, `Enter a valid amount to withdraw:`);
      try {
        const result = await djangoPost('/api/financial/savings/withdraw/', { phone: phoneClean, amount });
        await clearWASession(phone);
        return twimlReply(res, `✅ *Withdrawal Successful!*\n\nWithdrawn: ₦${amount.toLocaleString()}\nRemaining Savings: ₦${result.savings_balance ?? 0}\nFunds added to your wallet.`);
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Withdrawal failed: ${err.message}.`);
      }
    }

    else if (session.step === 'loan_apply_amount') {
      const amount = parseInt(Body.replace(/[^0-9]/g, ''));
      const limit = session.data.limit ?? 0;
      if (!amount) return twimlReply(res, `Enter a valid amount in ₦:`);
      if (amount > limit) return twimlReply(res, `❌ Exceeds your limit of ₦${limit.toLocaleString()}.\nEnter a lower amount:`);
      try {
        const result = await djangoPost('/api/financial/loans/apply/', { phone: phoneClean, amount });
        await clearWASession(phone);
        return twimlReply(res,
          `✅ *Loan Approved!*\n\nAmount: ₦${amount.toLocaleString()}\nFee (5%): ₦${(amount * 0.05).toLocaleString()}\nTotal Repayment: ₦${Math.ceil(amount * 1.05).toLocaleString()}\nSchedule: Weekly auto-deduct (Mondays)\n\nFunds in your wallet. 💰\nRef: ${result.reference ?? 'N/A'}`
        );
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Loan failed: ${err.message}.`);
      }
    }

    else if (session.step === 'loan_prepay_amount') {
      const amount = parseInt(Body.replace(/[^0-9]/g, ''));
      if (!amount) return twimlReply(res, `Enter a valid repayment amount:`);
      try {
        const result = await djangoPost('/api/financial/loans/prepay/', { phone: phoneClean, amount });
        await clearWASession(phone);
        return twimlReply(res, `✅ *Repayment Recorded!*\n\nPaid: ₦${amount.toLocaleString()}\nRemaining: ₦${result.remaining_balance ?? 0}\n\nEarly repayment improves your score! 📈`);
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Repayment failed: ${err.message}.`);
      }
    }

    else if (session.step === 'insurance_confirm') {
      if (Body.trim().toLowerCase() === 'yes' || Body.trim().toLowerCase() === 'y') {
        try {
          await djangoPost('/api/financial/insurance/activate/', { phone: phoneClean });
          await clearWASession(phone);
          return twimlReply(res, `✅ *Insurance Activated!*\n\n🛡️ Income Protection\nPremium: ₦200/day\nCoverage: Active now\n\nReply "claim insurance" to file a claim.`);
        } catch (err) {
          await clearWASession(phone);
          return twimlReply(res, `❌ Activation failed: ${err.message}.`);
        }
      } else {
        await clearWASession(phone);
        return twimlReply(res, `Cancelled. Reply "activate insurance" anytime to try again.`);
      }
    }

    else if (session.step === 'insurance_claim_amount') {
      const amount = parseInt(Body.replace(/[^0-9]/g, ''));
      if (!amount) return twimlReply(res, `Enter a valid claim amount:`);
      try {
        const result = await djangoPost('/api/financial/insurance/claim/', { phone: phoneClean, amount });
        await clearWASession(phone);
        if (result.status === 'approved') {
          return twimlReply(res, `✅ *Claim Approved!*\n\nAmount: ₦${amount.toLocaleString()}\nFunds added to wallet.\nRef: ${result.reference ?? 'N/A'}`);
        } else {
          return twimlReply(res, `📋 *Claim Under Review*\n\nAmount: ₦${amount.toLocaleString()}\nETA: 48 hours\nRef: ${result.reference ?? 'N/A'}\n\nWe'll SMS you when resolved.`);
        }
      } catch (err) {
        await clearWASession(phone);
        return twimlReply(res, `❌ Claim failed: ${err.message}.`);
      }
    }

    // ── Fallback ───────────────────────────────────────────
    else {
      await clearWASession(phone);
      return twimlReply(res, `Session expired. Reply "help" to start over.`);
    }

  } catch (err) {
    console.error('WhatsApp handler error:', err.message);
    await clearWASession(phone);
    return twimlReply(res, `Something went wrong. Please try again.`);
  }
}
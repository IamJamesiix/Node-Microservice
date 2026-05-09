import Redis from 'ioredis';
import { sendSMS } from './smsService.js';
import { sendWhatsApp } from '../controllers/whatsappController.js';
import config from '../config/dotenv.js';

const sub = config.REDIS_URL.startsWith('rediss://')
  ? new Redis(config.REDIS_URL, { tls: {} })
  : new Redis(config.REDIS_URL);

sub.on('connect', () => console.log('📡 Redis subscriber connected'));
sub.on('error', (err) => console.error('Redis subscriber error:', err.message));

sub.subscribe(
  'kolliq:jobs',
  'kolliq:payments',
  'kolliq:financial',
  (err, count) => {
    if (err) return console.error('Subscribe error:', err.message);
    console.log(`📡 Subscribed to ${count} Redis channels`);
  }
);

sub.on('message', async (channel, message) => {
  try {
    const payload = JSON.parse(message);
    console.log(`📨 [${channel}] ${payload.event}`);

    // ── JOB EVENTS ────────────────────────────────────────
    if (channel === 'kolliq:jobs') {

      // Django publishes this when a worker is matched to a job
      if (payload.event === 'job.matched') {
        await sendSMS(
          payload.worker_phone,
          `🔔 Kolliq Job Alert!\n` +
          `${payload.employer_name || 'An employer'} needs a ${payload.skill} in ${payload.location}.\n` +
          `Pay: ₦${payload.pay}\nTime: ${payload.time}\nJob ID: ${payload.job_id}\n\n` +
          `Reply on WhatsApp or dial *347*1234# to accept.`
        );
        console.log(`✅ Job match SMS → ${payload.worker_phone}`);
      }

      // Django publishes this when a worker accepts a job
      if (payload.event === 'job.accepted') {
        if (payload.employer_whatsapp) {
          await sendWhatsApp(
            payload.employer_whatsapp,
            `✅ *Kolliq: Worker Accepted Your Job!*\n\n` +
            `👷 ${payload.worker_name || 'Verified Worker'}\n` +
            `📞 ${payload.worker_phone}\n` +
            `🔑 Job ID: ${payload.job_id}\n` +
            `💼 ${payload.skill}\n\n` +
            `They will contact you shortly.\n` +
            `Reply "job done ${payload.job_id}" when complete to release payment.`
          );
          console.log(`✅ Worker accepted WhatsApp → employer ${payload.employer_whatsapp}`);
        }

        // Also SMS the worker confirmation
        if (payload.worker_phone) {
          await sendSMS(
            payload.worker_phone,
            `✅ Kolliq: You accepted Job ${payload.job_id}.\n${payload.skill} in ${payload.location}.\nTime: ${payload.time}\nPay: ₦${payload.pay}\nBe on time! 💪`
          );
        }
      }

      // Django publishes this when employer confirms job done + escrow released
      if (payload.event === 'job.completed') {
        const naira = typeof payload.amount === 'number'
          ? (payload.amount / 100).toFixed(2)
          : payload.amount;

        // SMS worker
        await sendSMS(
          payload.worker_phone,
          `💰 Kolliq: ₦${naira} released to your wallet!\nJob ID: ${payload.job_id}\nDial *347*1234# to check balance.\nKeep grinding! 🔥`
        );

        // WhatsApp employer receipt
        if (payload.employer_whatsapp) {
          await sendWhatsApp(
            payload.employer_whatsapp,
            `🎉 *Job ${payload.job_id} Complete!*\n\nPayment of ₦${naira} released to worker.\nThank you for using Kolliq! Post your next job anytime.`
          );
        }

        console.log(`✅ Job complete notifications sent for Job ${payload.job_id}`);
      }
    }

    // ── PAYMENT EVENTS ────────────────────────────────────
    if (channel === 'kolliq:payments') {

      if (payload.event === 'payment.credited') {
        // SMS already sent in webhookController
        // Just log here — Django Celery handles score recalc
        console.log(`💳 Payment credited: ${payload.phone} ₦${payload.naira}`);
      }

      if (payload.event === 'escrow.released') {
        console.log(`🔓 Escrow released: ${payload.phone} ₦${payload.naira}`);
      }
    }

    // ── FINANCIAL EVENTS (Day 3) ──────────────────────────
    if (channel === 'kolliq:financial') {

      // Loan disbursed (Django triggers after approval)
      if (payload.event === 'loan.disbursed') {
        await sendSMS(
          payload.phone,
          `💰 Kolliq Loan: ₦${payload.amount} disbursed to your wallet!\n` +
          `Repayment: ₦${payload.repayment_amount} (auto-deducted Mondays)\n` +
          `Ref: ${payload.reference}\n` +
          `Keep your balance topped up each week. 🙏`
        );
        console.log(`✅ Loan disbursed SMS → ${payload.phone}`);
      }

      // Loan repayment auto-deducted (Django Celery Monday task)
      if (payload.event === 'loan.repayment_deducted') {
        await sendSMS(
          payload.phone,
          `📅 Kolliq: Weekly loan repayment of ₦${payload.amount} deducted.\n` +
          `Remaining balance: ₦${payload.remaining_balance}\n` +
          `${payload.remaining_balance <= 0 ? '✅ Loan fully repaid! Well done!' : 'Keep it up! 💪'}`
        );
        console.log(`✅ Loan repayment SMS → ${payload.phone}`);
      }

      // Insurance premium deducted (Django Celery daily task)
      if (payload.event === 'insurance.premium_deducted') {
        // Silent deduction — only notify if balance is getting low
        console.log(`🛡️ Insurance premium ₦200 deducted for ${payload.phone}`);
      }

      // Insurance claim approved
      if (payload.event === 'insurance.claim_approved') {
        await sendSMS(
          payload.phone,
          `✅ Kolliq Insurance: Claim of ₦${payload.amount} approved!\n` +
          `Funds added to your wallet.\nRef: ${payload.reference}\nStay protected! 🛡️`
        );
        console.log(`✅ Insurance claim approved SMS → ${payload.phone}`);
      }

      // Savings interest accrued (Django Celery daily task)
      if (payload.event === 'savings.interest_accrued') {
        // Silent — only notify on weekly summary (let Django handle that)
        console.log(`📈 Savings interest accrued for ${payload.phone}: ₦${payload.interest_amount}`);
      }

      // Score updated (EIS recalculation)
      if (payload.event === 'score.updated') {
        const { phone, old_score, new_score, newly_unlocked } = payload;

        // Only notify if score crossed a threshold
        const milestones = [
          { score: 30, service: 'Basic Savings' },
          { score: 50, service: 'Loan Eligibility' },
          { score: 70, service: 'Income Insurance' },
          { score: 90, service: 'Premium Services' },
        ];

        const crossed = milestones.find(
          (m) => old_score < m.score && new_score >= m.score
        );

        if (crossed) {
          await sendSMS(
            phone,
            `🎉 Kolliq: Your score hit ${new_score}/100!\n` +
            `You just unlocked: ${crossed.service}!\n` +
            `WhatsApp us or dial *347*1234# to access it now. 🔥`
          );
          console.log(`✅ Score milestone SMS → ${phone} (${old_score} → ${new_score})`);
        }
      }
    }

  } catch (err) {
    console.error('Subscriber message error:', err.message);
  }
});

export default sub;
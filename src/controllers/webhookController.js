import crypto from 'crypto';
import axios from 'axios';
import { sendSMS } from '../services/smsService.js';
import 'dotenv/config';

function verifySquadSignature(rawBody, signature) {
  const hash = crypto
    .createHmac('sha512', process.env.SQUAD_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex')
    .toUpperCase();

  return hash === signature?.toUpperCase();
}

export async function handleSquadWebhook(req, res) {
  // Squad sends the raw body signature in x-squad-encrypted-body
  const signature = req.headers['x-squad-encrypted-body'];
  const rawBody = JSON.stringify(req.body); // express.json() already parsed it

  if (!verifySquadSignature(rawBody, signature)) {
    console.warn('❌ Invalid Squad webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;
  const eventType = event?.Event;

  console.log('📦 Squad webhook received:', eventType);

  try {
    if (eventType === 'virtual_account.credited') {
      const { phone_number, amount, virtual_account_number, transaction_reference } = event?.Body || {};

      // Notify Django to record the transaction + update EIS score
      await axios.post(`${process.env.DJANGO_API_URL}/api/transactions/record/`, {
        phone: phone_number,
        amount,
        account_number: virtual_account_number,
        reference: transaction_reference,
        type: 'credit',
        source: 'squad_webhook',
      });

      // Send SMS notification via Africa's Talking
      if (phone_number) {
        const naira = (amount / 100).toFixed(2); // Squad sends kobo
        await sendSMS(
          phone_number,
          `✅ Trybe: You received ₦${naira}. Acct: ${virtual_account_number}. Ref: ${transaction_reference}.`
        );
      }

      return res.status(200).json({ status: 'processed' });
    }

    // Acknowledge unknown events so Squad doesn't retry
    return res.status(200).json({ status: 'ignored', event: eventType });
  } catch (err) {
    console.error('Webhook processing error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

export async function handleWhatsAppWebhook(req, res) {
  // Stub for Twilio — will expand Day 2
  console.log('WhatsApp webhook received:', req.body);
  return res.status(200).json({ status: 'received' });
}
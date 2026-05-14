import redis from '../config/redis.js';
import { sendSMS } from './smsService.js';

const OTP_TTL = 5 * 60; // 5 minutes in seconds

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function requestOTP(phone) {
  const otp = generateOTP();
  const key = `otp:${phone}`;

  await redis.set(key, otp, 'EX', OTP_TTL);

  await sendSMS(phone, `Your Kolliq verification code is ${otp}. Valid for 5 minutes. Do not share it.`);

  return { message: 'OTP sent successfully' };
}

export async function verifyOTP(phone, otp) {
  const key = `otp:${phone}`;
  const stored = await redis.get(key);

  if (!stored) throw new Error('OTP expired or not found');
  if (stored !== otp) throw new Error('Invalid OTP');

  await redis.del(key); // one-time use
  return true;
}
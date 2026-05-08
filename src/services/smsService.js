import AfricasTalking from 'africastalking';
import 'dotenv/config';

const AT = AfricasTalking({
  apiKey: process.env.AT_API_KEY,
  username: process.env.AT_USERNAME,
});

const sms = AT.SMS;

export async function sendSMS(to, message) {
  const result = await sms.send({
    to: [to],
    message,
    from: process.env.AT_SENDER_ID,
  });
  return result;
}
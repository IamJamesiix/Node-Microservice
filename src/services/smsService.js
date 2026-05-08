import AfricasTalking from 'africastalking';
import config from '../config/dotenv.js';

const AT = AfricasTalking({
  apiKey: config.AT_API_KEY,
  username: config.AT_USERNAME,
});

const sms = AT.SMS;

export async function sendSMS(to, message) {
  const result = await sms.send({
    to: [to],
    message,
    from: config.AT_SENDER_ID,
  });
  return result;
}
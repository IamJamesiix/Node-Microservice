import redis from '../config/redis.js';
import axios from 'axios';
import config from '../config/dotenv.js';

const QUEUE_KEY = 'kolliq:retry_queue';
const MAX_ATTEMPTS = 5;
const RETRY_INTERVAL_MS = 30000; // 30 seconds

export async function queueFailedCall({ url, body, headers = {} }) {
  const item = {
    url,
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': config.DJANGO_API_SECRET,
      ...headers,
    },
    queued_at: new Date().toISOString(),
    attempts: 0,
  };

  await redis.lpush(QUEUE_KEY, JSON.stringify(item));
  console.log(`📥 Queued failed call → ${url}`);
}

async function processRetryQueue() {
  try {
    const raw = await redis.rpop(QUEUE_KEY);
    if (!raw) return;

    const item = JSON.parse(raw);
    item.attempts += 1;

    try {
      await axios.post(item.url, item.body, {
        headers: item.headers,
        timeout: 8000,
      });
      console.log(`✅ Retry succeeded (attempt ${item.attempts}): ${item.url}`);
    } catch (err) {
      if (item.attempts < MAX_ATTEMPTS) {
        await redis.lpush(QUEUE_KEY, JSON.stringify(item));
        console.log(`🔄 Re-queued (attempt ${item.attempts}/${MAX_ATTEMPTS}): ${item.url}`);
      } else {
        console.error(`❌ Max retries reached, dropping: ${item.url}`, err.message);
        await redis.lpush('kolliq:dead_letter', JSON.stringify({
          ...item,
          final_error: err.message,
          failed_at: new Date().toISOString(),
        }));
      }
    }
  } catch (err) {
    console.error('Retry queue processor error:', err.message);
  }
}

setInterval(processRetryQueue, RETRY_INTERVAL_MS);
console.log(`🔁 Retry queue started (every ${RETRY_INTERVAL_MS / 1000}s)`);

export default { queueFailedCall };
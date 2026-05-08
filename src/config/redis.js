import Redis from 'ioredis';
import 'dotenv/config';

const redis = new Redis(process.env.REDIS_URL, {
  tls: {},
  maxRetriesPerRequest: 3,
});

redis.on('connect', () => console.log('✅ Redis connected'));
redis.on('error', (err) => console.error('❌ Redis error:', err.message));

export default redis;
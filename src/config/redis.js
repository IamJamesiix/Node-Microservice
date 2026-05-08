import Redis from 'ioredis';
import config from './dotenv.js';

const redis = new Redis(config.REDIS_URL, {
  tls: {},
  maxRetriesPerRequest: 3,
});

redis.on('connect', () => console.log('✅ Redis connected'));
redis.on('error', (err) => console.error('❌ Redis error:', err.message));

export default redis;
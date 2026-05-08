import Redis from 'ioredis';
import config from './dotenv.js';



const redis = config.REDIS_URL.startsWith('rediss://')
  ? new Redis(config.REDIS_URL, { tls: {} })
  : new Redis(config.REDIS_URL);


redis.on('connect', () => console.log('✅ Redis connected'));
redis.on('error', (err) => console.error('❌ Redis error:', err.message));

export default redis;
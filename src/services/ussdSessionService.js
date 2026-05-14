import redis from '../config/redis.js';

const SESSION_TTL = 60 * 5; // 5 minutes

export async function getSession(sessionId) {
  const raw = await redis.get(`ussd:${sessionId}`);
  return raw ? JSON.parse(raw) : { step: 'welcome', data: {} };
}

export async function setSession(sessionId, state) {
  await redis.set(`ussd:${sessionId}`, JSON.stringify(state), 'EX', SESSION_TTL);
}

export async function clearSession(sessionId) {
  await redis.del(`ussd:${sessionId}`);
}
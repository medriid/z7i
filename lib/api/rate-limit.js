import { isRedisConfigured, redisIncrWithExpire } from './redis-cache.js';

const store = new Map();

function readIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  return String(raw).split(',')[0].trim() || 'unknown';
}

function gc(now) {
  for (const [key, bucket] of store.entries()) {
    bucket.hits = bucket.hits.filter((ts) => now - ts < 60_000);
    if (bucket.hits.length === 0) store.delete(key);
  }
}

function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  if (store.size > 5000) gc(now);
  const bucket = store.get(key) || { hits: [] };
  bucket.hits = bucket.hits.filter((ts) => now - ts < windowMs);
  if (bucket.hits.length >= limit) {
    const retryAfterMs = windowMs - (now - bucket.hits[0]);
    store.set(key, bucket);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  bucket.hits.push(now);
  store.set(key, bucket);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function enforceRateLimit(req, scope, limit, windowMs) {
  const ip = readIp(req);
  return rateLimit(`${scope}:${ip}`, limit, windowMs);
}

export async function enforceRateLimitAsync(req, scope, limit, windowMs) {
  if (!isRedisConfigured()) {
    return enforceRateLimit(req, scope, limit, windowMs);
  }

  const ip = readIp(req);
  const key = `rate:${scope}:${ip}`;
  const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const count = await redisIncrWithExpire(key, ttlSeconds);

  if (count === null) {
    return enforceRateLimit(req, scope, limit, windowMs);
  }

  if (count > limit) {
    return { allowed: false, retryAfterSeconds: ttlSeconds };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

import { redisCommand, isRedisConfigured } from './redis-cache.js';

export async function enqueueJob(queue: string, payload: unknown) {
  if (!isRedisConfigured()) {
    return { queued: false, reason: 'redis_not_configured' as const };
  }
  await redisCommand('LPUSH', `queue:${queue}`, JSON.stringify({ payload, createdAt: new Date().toISOString() }));
  return { queued: true as const };
}

export async function dequeueJob<T = unknown>(queue: string): Promise<T | null> {
  if (!isRedisConfigured()) return null;
  const raw = await redisCommand<string>('RPOP', `queue:${queue}`);
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { payload: T }).payload;
  } catch {
    return null;
  }
}

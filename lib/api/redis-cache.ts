const REDIS_REST_URL = process.env.REDIS__REST_URL;
const REDIS_REST_TOKEN = process.env.REDIS_REST_TOKEN;

function isConfigured() {
  return Boolean(REDIS_REST_URL && REDIS_REST_TOKEN);
}

async function redisCommand<T = unknown>(...command: (string | number)[]): Promise<T | null> {
  if (!isConfigured()) return null;
  const url = `${REDIS_REST_URL}/${command.map((item) => encodeURIComponent(String(item))).join('/')}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_REST_TOKEN}`,
      },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { result?: T };
    return payload.result ?? null;
  } catch (error) {
    console.error('Redis command failed', command[0], error);
    return null;
  }
}

export async function redisIncrWithExpire(key: string, ttlSeconds: number): Promise<number | null> {
  const value = await redisCommand<number>('INCR', key);
  if (typeof value !== 'number') return null;
  if (value === 1) {
    await redisCommand('EXPIRE', key, ttlSeconds);
  }
  return value;
}

export async function redisGetJson<T>(key: string): Promise<T | null> {
  const raw = await redisCommand<string>('GET', key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function redisSetJson(key: string, value: unknown, ttlSeconds: number) {
  await redisCommand('SETEX', key, ttlSeconds, JSON.stringify(value));
}

export async function redisDel(key: string) {
  await redisCommand('DEL', key);
}

export async function redisSAdd(key: string, member: string, ttlSeconds = 60 * 60 * 6) {
  await redisCommand('SADD', key, member);
  await redisCommand('EXPIRE', key, ttlSeconds);
}

export async function redisSRem(key: string, member: string) {
  await redisCommand('SREM', key, member);
}

export async function redisSMembers(key: string): Promise<string[]> {
  const result = await redisCommand<string[]>('SMEMBERS', key);
  return Array.isArray(result) ? result : [];
}

export function isRedisConfigured() {
  return isConfigured();
}

export { redisCommand };

import { incrementMetric, observeMetric } from './metrics.js';

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message = 'Operation timed out'): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function retryTransient<T>(fn: () => Promise<T>, maxRetries = 2, baseDelayMs = 200): Promise<T> {
  let attempt = 0;
  while (true) {
    const startedAt = Date.now();
    try {
      const result = await fn();
      observeMetric('resilience.retry.duration_ms', Date.now() - startedAt);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      const isTransient = message.includes('timeout') || message.includes('rate') || message.includes('429') || message.includes('network');
      if (!isTransient || attempt >= maxRetries) {
        incrementMetric('resilience.retry.failures');
        throw error;
      }
      incrementMetric('resilience.retry.retries');
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
}

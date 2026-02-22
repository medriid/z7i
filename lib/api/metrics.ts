const counters = new Map<string, number>();
const timings = new Map<string, { count: number; totalMs: number; maxMs: number }>();

export function incrementMetric(name: string, value = 1) {
  counters.set(name, (counters.get(name) || 0) + value);
}

export function observeMetric(name: string, durationMs: number) {
  const current = timings.get(name) || { count: 0, totalMs: 0, maxMs: 0 };
  current.count += 1;
  current.totalMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  timings.set(name, current);
}

export function getMetricsSnapshot() {
  return {
    counters: Object.fromEntries(counters.entries()),
    timings: Object.fromEntries(
      Array.from(timings.entries()).map(([name, value]) => [
        name,
        {
          count: value.count,
          avgMs: value.count ? Math.round((value.totalMs / value.count) * 100) / 100 : 0,
          maxMs: value.maxMs,
        },
      ])
    ),
  };
}

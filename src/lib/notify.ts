// Pure, browser-safe helpers shared by the worker and tests.
export const MAX_ATTEMPTS = 5;
export const FAIL_RATE = 0.3;

/** Seconds until the next attempt after `attempts` failures (1, 2, 4, 8...). */
export function backoffSeconds(attempts: number) {
  return 2 ** Math.max(0, attempts);
}

/** Simulated email/SMS provider. Fails randomly so retries and dead letters are visible. */
export async function sendNotification(
  _job: { id: string; kind: string },
  rand: () => number = Math.random,
) {
  await new Promise((r) => setTimeout(r, 20));
  if (rand() < FAIL_RATE) throw new Error("provider timeout");
}

export function p95(values: number[]) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)];
}

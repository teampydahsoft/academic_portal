type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function clientKey(ip: string | undefined): string {
  return `login:${ip || "unknown"}`;
}

export type LoginRateLimitOptions = {
  windowMs?: number;
  maxAttempts?: number;
};

function limits(options?: LoginRateLimitOptions) {
  return {
    windowMs: options?.windowMs ?? Number(process.env.AP_LOGIN_RATE_WINDOW_MS ?? 15 * 60 * 1000),
    maxAttempts: options?.maxAttempts ?? Number(process.env.AP_LOGIN_RATE_MAX ?? 20),
  };
}

/**
 * Returns retry-after seconds when the client is currently throttled, else null.
 * Call before attempting credential verification.
 */
export function getLoginThrottleRetryAfter(
  ip: string | undefined,
  options?: LoginRateLimitOptions,
): number | null {
  const { windowMs, maxAttempts } = limits(options);
  const now = Date.now();
  const key = clientKey(ip);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) return null;
  if (bucket.count >= maxAttempts) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  }
  return null;
}

/**
 * Record a failed login attempt. Successful logins do not call this.
 */
export function recordFailedLoginAttempt(
  ip: string | undefined,
  options?: LoginRateLimitOptions,
): { throttled: boolean; retryAfterSec: number } {
  const { windowMs, maxAttempts } = limits(options);
  const now = Date.now();
  const key = clientKey(ip);
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count >= maxAttempts) {
    return {
      throttled: true,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { throttled: false, retryAfterSec: 0 };
}

/** Test helper for in-process unit checks only. */
export function resetLoginRateLimitForTests() {
  buckets.clear();
}

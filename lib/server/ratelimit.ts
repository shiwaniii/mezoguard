/** In-memory token bucket per key (per server instance — good enough to stop accidental hammering of the RPC). */
import "./guard";

interface Bucket { tokens: number; at: number }
const buckets = new Map<string, Bucket>();

export interface RateLimitResult { ok: boolean; retryAfterSeconds: number; remaining: number }

export function rateLimit(key: string, capacity: number, refillPerSecond: number, now = Date.now()): RateLimitResult {
  let b = buckets.get(key);
  if (!b) {
    if (buckets.size > 10_000) buckets.clear();
    b = { tokens: capacity, at: now };
    buckets.set(key, b);
  }
  b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * refillPerSecond);
  b.at = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { ok: true, retryAfterSeconds: 0, remaining: Math.floor(b.tokens) };
  }
  return { ok: false, retryAfterSeconds: Math.ceil((1 - b.tokens) / refillPerSecond), remaining: 0 };
}

export function resetRateLimits(): void {
  buckets.clear();
}

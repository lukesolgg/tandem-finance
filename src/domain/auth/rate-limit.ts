/**
 * Tiny in-memory sliding-window limiter for login/sign-up. A two-person,
 * single-instance app doesn't need Redis; if you scale out, swap this for one.
 */
const hits = new Map<string, number[]>();

export function rateLimit(key: string, limit = 8, windowMs = 15 * 60_000): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

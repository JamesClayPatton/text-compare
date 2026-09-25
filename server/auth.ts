// The admin password check and the session cookie. The password lives only in
// the server's environment; the browser gets a signed, expiring token.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const MAX_FAILS = 5;
export const LOCKOUT_MS = 15 * 60_000;
export const SESSION_MS = 12 * 60 * 60_000;

export type LoginResult = { ok: true; token: string } | { ok: false; retryAfterMs?: number };

const sha = (s: string) => createHash("sha256").update(s).digest();

export class AdminAuth {
  private fails = new Map<string, { count: number; until: number }>();
  private key: Buffer;
  private password: string;
  private now: () => number;

  constructor(password: string, secret = randomBytes(32).toString("hex"), now = Date.now) {
    this.password = password;
    this.now = now;
    // the password is part of the signing key, so changing it signs everyone out
    this.key = createHmac("sha256", secret).update(password).digest();
  }

  login(ip: string, attempt: string): LoginResult {
    const t = this.now();
    const f = this.fails.get(ip);
    if (f && f.until > t) return { ok: false, retryAfterMs: f.until - t };
    if (timingSafeEqual(sha(attempt), sha(this.password))) {
      this.fails.delete(ip);
      return { ok: true, token: this.issue(t + SESSION_MS) };
    }
    const count = (f && f.until === 0 ? f.count : 0) + 1;
    this.fails.set(ip, count >= MAX_FAILS ? { count: 0, until: t + LOCKOUT_MS } : { count, until: 0 });
    if (this.fails.size > 10_000) this.prune(t);
    return count >= MAX_FAILS ? { ok: false, retryAfterMs: LOCKOUT_MS } : { ok: false };
  }

  verify(token: string | undefined): boolean {
    if (!token) return false;
    const [exp, sig] = token.split(".");
    if (!exp || !sig || !/^\d+$/.test(exp)) return false;
    const want = this.sign(exp);
    const got = Buffer.from(sig);
    return got.length === want.length && timingSafeEqual(got, want) && Number(exp) > this.now();
  }

  private issue(exp: number): string {
    return `${exp}.${this.sign(String(exp)).toString()}`;
  }

  private sign(exp: string): Buffer {
    return Buffer.from(createHmac("sha256", this.key).update(exp).digest("base64url"));
  }

  private prune(t: number) {
    for (const [ip, f] of this.fails) if (f.until !== 0 && f.until <= t) this.fails.delete(ip);
  }
}

/** A fixed-window limit per key (an IP address), kept only in memory. */
export class RateLimiter {
  private hits = new Map<string, { n: number; start: number }>();
  private limit: number;
  private windowMs: number;
  private now: () => number;

  constructor(limit: number, windowMs: number, now = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  allow(key: string): boolean {
    const t = this.now();
    const h = this.hits.get(key);
    if (!h || t - h.start >= this.windowMs) {
      if (this.hits.size > 50_000) this.hits.clear();
      this.hits.set(key, { n: 1, start: t });
      return true;
    }
    h.n++;
    return h.n <= this.limit;
  }
}

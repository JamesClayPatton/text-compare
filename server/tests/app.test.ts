import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { AdminAuth, LOCKOUT_MS, MAX_FAILS, RateLimiter } from "../auth.ts";
import { UsageStore } from "../store.ts";
import { SupabaseAdmin } from "../supabase.ts";

const compare = { e: "compare", kind: "word", view: "split", page: "word-compare", size: "100-1k", source: "file", signedIn: false };

const json = async (r: Promise<Response>): Promise<any> => (await r).json();

let server: Server | null = null;
afterEach(() => server?.close());

async function start(opts: { password?: string; supabase?: SupabaseAdmin | null; today?: string; limit?: number } = {}) {
  const store = new UsageStore(":memory:");
  const auth = opts.password === undefined ? new AdminAuth("correct horse") : opts.password ? new AdminAuth(opts.password) : null;
  const now = () => new Date(`${opts.today ?? "2026-09-24"}T12:00:00Z`);
  server = createServer(createApp({ store, auth, supabase: opts.supabase ?? null, now, eventLimitPerMinute: opts.limit }));
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const event = (body: unknown, ip = "1.1.1.1") =>
    fetch(`${base}/api/event`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "cf-connecting-ip": ip } });
  const login = (password: string, ip = "2.2.2.2") =>
    fetch(`${base}/api/admin/login`, { method: "POST", body: JSON.stringify({ password }), headers: { "content-type": "application/json", "cf-connecting-ip": ip } });
  const stats = (cookie?: string) => fetch(`${base}/api/admin/stats`, { headers: cookie ? { cookie } : {} });
  const session = async () => (await login("correct horse")).headers.get("set-cookie")!.split(";")[0];
  return { base, store, event, login, stats, session };
}

describe("POST /api/event", () => {
  it("counts valid events", async () => {
    const { event, stats, session } = await start();
    for (let i = 0; i < 3; i++) expect((await event(compare)).status).toBe(204);
    expect((await event({ e: "share" })).status).toBe(204);
    expect((await event({ e: "file_import", kind: "word" })).status).toBe(204);
    const body = await json(stats(await session()));
    expect(body.usage.totals).toEqual({ today: 3, d7: 3, d30: 3, all: 3 });
    expect(body.usage.breakdown.kind).toEqual({ word: 3 });
    expect(body.usage.breakdown.signed_in).toEqual({ yes: 0, no: 3 });
    expect(body.usage.features.range).toEqual({ share: 1, file_import: 1 });
    expect(body.usage.imports).toEqual({ word: 1 });
    expect(body.usage.daily.at(-1)).toEqual({ day: "2026-09-24", compares: 3 });
    expect(body.usage.daily).toHaveLength(30);
  });

  it("rejects anything off the list, so no text can be stored", async () => {
    const { event, store } = await start();
    expect((await event({ ...compare, text: "my secret contract" })).status).toBe(400);
    expect((await event({ ...compare, kind: "my secret contract" })).status).toBe(400);
    expect((await event("not json")).status).toBe(400);
    expect((await event("x".repeat(5000))).status).toBe(413);
    expect(store.stats("2026-09-24", 30).totals.all).toBe(0);
  });

  it("only accepts POST", async () => {
    const { base } = await start();
    expect((await fetch(`${base}/api/event`)).status).toBe(405);
  });

  it("rate-limits one address without blocking others", async () => {
    const { event } = await start({ limit: 3 });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await event({ e: "share" }, "9.9.9.9")).status);
    expect(codes).toEqual([204, 204, 204, 429, 429]);
    expect((await event({ e: "share" }, "8.8.8.8")).status).toBe(204);
  });
});

describe("admin login and stats", () => {
  it("needs a session for stats", async () => {
    const { stats } = await start();
    expect((await stats()).status).toBe(401);
    expect((await stats("tc_admin=123.abc")).status).toBe(401);
  });

  it("logs in with the right password and sets a locked-down cookie", async () => {
    const { login, stats } = await start();
    expect((await login("wrong")).status).toBe(401);
    const res = await login("correct horse");
    expect(res.status).toBe(204);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toMatch(/Path=\/api\/admin/);
    expect((await stats(setCookie.split(";")[0])).status).toBe(200);
  });

  it("locks an address out after repeated wrong passwords", async () => {
    const { login } = await start();
    for (let i = 0; i < MAX_FAILS - 1; i++) expect((await login("nope", "5.5.5.5")).status).toBe(401);
    expect((await login("nope", "5.5.5.5")).status).toBe(429);
    const locked = await login("correct horse", "5.5.5.5");
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await login("correct horse", "6.6.6.6")).status).toBe(204);
  });

  it("refuses logins sent as a form (so other sites can't post one)", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/admin/login`, { method: "POST", body: "password=correct+horse", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(res.status).toBe(415);
  });

  it("is switched off without a password", async () => {
    const { login, stats } = await start({ password: "" });
    expect((await login("anything")).status).toBe(503);
    expect((await stats()).status).toBe(503);
  });

  it("explains when accounts aren't configured", async () => {
    const { stats, session } = await start();
    const body = await json(stats(await session()));
    expect(body.accounts).toBeNull();
    expect(body.accountsError).toMatch(/SUPABASE_SERVICE_KEY/);
  });

  it("combines Supabase users with their storage figures", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      if (url.includes("/auth/v1/admin/users")) {
        return Response.json({
          users: [
            { id: "u1", email: "a@x.com", created_at: "2026-09-20T10:00:00Z", last_sign_in_at: "2026-09-23T10:00:00Z", app_metadata: { provider: "google" }, user_metadata: { contact_ok: true, contact_consent_at: "2026-09-20T10:00:00Z" } },
            { id: "u2", email: "b@x.com", created_at: "2026-01-01T10:00:00Z", last_sign_in_at: null, app_metadata: { provider: "email" } },
          ],
        });
      }
      return Response.json([{ user_id: "u1", saved_count: 4, history_count: 10, bytes_used: 2048, last_activity: "2026-09-24T09:00:00Z" }]);
    }) as typeof fetch;
    const { stats, session } = await start({ supabase: new SupabaseAdmin("https://p.supabase.co/", "sb_secret_abc", fakeFetch) });
    const body = await json(stats(await session()));
    expect(body.users).toEqual([
      { email: "a@x.com", provider: "google", createdAt: "2026-09-20T10:00:00Z", lastSignInAt: "2026-09-23T10:00:00Z", contactOk: true, contactConsentAt: "2026-09-20T10:00:00Z", saved: 4, history: 10, bytes: 2048, lastActivity: "2026-09-24T09:00:00Z" },
      { email: "b@x.com", provider: "email", createdAt: "2026-01-01T10:00:00Z", lastSignInAt: null, contactOk: false, contactConsentAt: null, saved: 0, history: 0, bytes: 0, lastActivity: null },
    ]);
    expect(body.accounts).toMatchObject({ total: 2, new7: 1, new30: 1, active30: 1, contactOk: 1, withLibrary: 1 });
    expect(body.accounts.signupsByDay).toEqual({ "2026-09-20": 1 });
    // a new-style secret key goes in apikey only
    expect(calls[0].url).toBe("https://p.supabase.co/auth/v1/admin/users?page=1&per_page=1000");
    expect(calls[0].headers.apikey).toBe("sb_secret_abc");
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("still shows usage when Supabase fails", async () => {
    const failing = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    const { stats, session } = await start({ supabase: new SupabaseAdmin("https://p.supabase.co", "k", failing) });
    const body = await json(stats(await session()));
    expect(body.users).toBeNull();
    expect(body.accountsError).toMatch(/500/);
    expect(body.usage.totals.all).toBe(0);
  });
});

describe("AdminAuth", () => {
  it("expires sessions and unlocks after the lockout", () => {
    let t = 1_000_000;
    const auth = new AdminAuth("pw", "secret", () => t);
    const ok = auth.login("ip", "pw");
    expect(ok.ok).toBe(true);
    const token = ok.ok ? ok.token : "";
    expect(auth.verify(token)).toBe(true);
    expect(auth.verify(token.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBe(false);
    t += 13 * 3600_000;
    expect(auth.verify(token)).toBe(false);
    for (let i = 0; i < MAX_FAILS; i++) auth.login("ip", "x");
    expect(auth.login("ip", "pw").ok).toBe(false);
    t += LOCKOUT_MS;
    expect(auth.login("ip", "pw").ok).toBe(true);
  });

  it("signs everyone out when the password changes", () => {
    const a = new AdminAuth("old", "secret");
    const r = a.login("ip", "old");
    expect(new AdminAuth("new", "secret").verify(r.ok ? r.token : "")).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("resets each window", () => {
    let t = 0;
    const rl = new RateLimiter(2, 1000, () => t);
    expect([rl.allow("a"), rl.allow("a"), rl.allow("a")]).toEqual([true, true, false]);
    t = 1000;
    expect(rl.allow("a")).toBe(true);
  });
});

describe("UsageStore", () => {
  it("keeps only daily counters, with no per-event rows", () => {
    const s = new UsageStore(":memory:");
    s.add(compare as never, "2026-09-01");
    s.add(compare as never, "2026-09-01");
    s.add(compare as never, "2026-09-24");
    const st = s.stats("2026-09-24", 7);
    expect(st.totals).toEqual({ today: 1, d7: 1, d30: 3, all: 3 });
    expect(st.daily.map((d) => d.compares)).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });
});

// HTTP routes for the usage counts and the admin panel. Everything else on the
// site is static files served by the web server in front of this one.

import type { IncomingMessage, ServerResponse } from "node:http";
import { parseUsageEvent } from "../src/usage-schema.ts";
import { type AdminAuth, RateLimiter } from "./auth.ts";
import { type UsageStore, dayOf } from "./store.ts";
import type { AdminUser, SupabaseAdmin } from "./supabase.ts";

export interface AppDeps {
  store: UsageStore;
  /** Null when no ADMIN_PASSWORD is set: the admin routes are then switched off. */
  auth: AdminAuth | null;
  /** Null when no Supabase service key is set. */
  supabase: SupabaseAdmin | null;
  now?: () => Date;
  eventLimitPerMinute?: number;
}

const COOKIE = "tc_admin";
const MAX_EVENT_BYTES = 2048;
const MAX_LOGIN_BYTES = 1024;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The visitor's address, only for rate limits. Cloudflare's header first, since the site is reached through its tunnel. */
function clientIp(req: IncomingMessage): string {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf) return cf;
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff) return xff.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

async function readBody(req: IncomingMessage, max: number): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, "Too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string | string[]> = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...(body === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }),
    ...headers,
  });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

function accountSummary(users: AdminUser[], today: string, days: number) {
  const since = (n: number) => Date.parse(`${today}T00:00:00Z`) - (n - 1) * 86_400_000;
  const signups: Record<string, number> = {};
  for (const u of users) {
    const d = u.createdAt.slice(0, 10);
    signups[d] = (signups[d] ?? 0) + 1;
  }
  return {
    total: users.length,
    new7: users.filter((u) => Date.parse(u.createdAt) >= since(7)).length,
    new30: users.filter((u) => Date.parse(u.createdAt) >= since(30)).length,
    active30: users.filter((u) => [u.lastSignInAt, u.lastActivity].some((t) => t && Date.parse(t) >= since(30))).length,
    contactOk: users.filter((u) => u.contactOk).length,
    withLibrary: users.filter((u) => u.saved + u.history > 0).length,
    signupsByDay: Object.fromEntries(Object.entries(signups).filter(([d]) => Date.parse(`${d}T00:00:00Z`) >= since(days))),
  };
}

export function createApp(deps: AppDeps) {
  const now = deps.now ?? (() => new Date());
  const eventLimit = new RateLimiter(deps.eventLimitPerMinute ?? 60, 60_000);
  const globalLimit = new RateLimiter((deps.eventLimitPerMinute ?? 60) * 50, 60_000);

  const secure = (req: IncomingMessage) => {
    if (!deps.auth) throw new HttpError(503, "The admin panel is off: set ADMIN_PASSWORD in server/.env.");
    if (!deps.auth.verify(cookie(req, COOKIE))) throw new HttpError(401, "Signed out");
  };

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (path === "/api/health" && req.method === "GET") return send(res, 200, { ok: true });

    if (path === "/api/event") {
      if (req.method !== "POST") throw new HttpError(405, "POST only");
      const body = await readBody(req, MAX_EVENT_BYTES);
      if (!eventLimit.allow(clientIp(req)) || !globalLimit.allow("all")) throw new HttpError(429, "Slow down");
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new HttpError(400, "Not JSON");
      }
      const event = parseUsageEvent(parsed);
      if (!event) throw new HttpError(400, "Unknown event");
      deps.store.add(event, dayOf(now()));
      return send(res, 204);
    }

    if (path === "/api/admin/login") {
      if (req.method !== "POST") throw new HttpError(405, "POST only");
      if (!deps.auth) throw new HttpError(503, "The admin panel is off: set ADMIN_PASSWORD in server/.env.");
      if (!/^application\/json\b/.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "Send JSON");
      let password = "";
      try {
        const o = JSON.parse(await readBody(req, MAX_LOGIN_BYTES)) as { password?: unknown };
        if (typeof o.password === "string") password = o.password;
      } catch (e) {
        if (e instanceof HttpError) throw e;
      }
      const result = deps.auth.login(clientIp(req), password);
      if (!result.ok) {
        if (result.retryAfterMs) {
          const s = Math.ceil(result.retryAfterMs / 1000);
          return send(res, 429, { error: `Too many wrong passwords. Try again in ${Math.ceil(s / 60)} minutes.` }, { "Retry-After": String(s) });
        }
        return send(res, 401, { error: "Wrong password" });
      }
      return send(res, 204, undefined, {
        "Set-Cookie": `${COOKIE}=${result.token}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${12 * 3600}`,
      });
    }

    if (path === "/api/admin/logout" && req.method === "POST") {
      return send(res, 204, undefined, { "Set-Cookie": `${COOKIE}=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
    }

    if (path === "/api/admin/stats" && req.method === "GET") {
      secure(req);
      const days = Math.min(365, Math.max(7, Number(url.searchParams.get("days")) || 30));
      const today = dayOf(now());
      const usage = deps.store.stats(today, days);
      let users: AdminUser[] | null = null;
      let accountsError: string | null = null;
      if (!deps.supabase) accountsError = "Add SUPABASE_URL and SUPABASE_SERVICE_KEY to server/.env to see accounts.";
      else {
        try {
          users = await deps.supabase.users();
        } catch (e) {
          accountsError = e instanceof Error ? e.message : "Couldn't reach Supabase.";
        }
      }
      return send(res, 200, {
        generatedAt: now().toISOString(),
        today,
        days,
        usage,
        accounts: users ? accountSummary(users, today, days) : null,
        users,
        accountsError,
      });
    }

    throw new HttpError(404, "Not found");
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await route(req, res);
    } catch (e) {
      if (res.headersSent) return res.end();
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(res, status, { error: e instanceof HttpError ? e.message : "Server error" });
    }
  };
}

// Account figures from Supabase, read with the service key (server only).
// Only who has an account and how much they store: never what they saved,
// which is encrypted in their browser anyway.

export interface AdminUser {
  email: string;
  provider: string;
  createdAt: string;
  lastSignInAt: string | null;
  contactOk: boolean;
  contactConsentAt: string | null;
  saved: number;
  history: number;
  bytes: number;
  lastActivity: string | null;
}

interface AuthUser {
  id: string;
  email?: string;
  created_at: string;
  last_sign_in_at?: string | null;
  app_metadata?: { provider?: string };
  user_metadata?: { contact_ok?: unknown; contact_consent_at?: unknown };
}

interface UsageRow {
  user_id: string;
  saved_count: number;
  history_count: number;
  bytes_used: number;
  last_activity: string | null;
}

export class SupabaseAdmin {
  private cache: { at: number; users: AdminUser[] } | null = null;
  private url: string;
  private key: string;
  private fetchFn: typeof fetch;
  private cacheMs: number;

  constructor(url: string, key: string, fetchFn: typeof fetch = fetch, cacheMs = 60_000) {
    this.url = url.replace(/\/$/, "");
    this.key = key;
    this.fetchFn = fetchFn;
    this.cacheMs = cacheMs;
  }

  private headers(): Record<string, string> {
    // new-style secret keys go in apikey only; a legacy service_role JWT goes in both
    const h: Record<string, string> = { apikey: this.key, "Content-Type": "application/json" };
    if (!this.key.startsWith("sb_")) h.Authorization = `Bearer ${this.key}`;
    return h;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchFn(`${this.url}${path}`, { ...init, headers: this.headers(), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Supabase ${path.split("?")[0]} answered ${res.status}`);
    return (await res.json()) as T;
  }

  async users(): Promise<AdminUser[]> {
    if (this.cache && Date.now() - this.cache.at < this.cacheMs) return this.cache.users;
    const all: AuthUser[] = [];
    for (let page = 1; page <= 100; page++) {
      const { users } = await this.json<{ users: AuthUser[] }>(`/auth/v1/admin/users?page=${page}&per_page=1000`);
      all.push(...users);
      if (users.length < 1000) break;
    }
    let usage = new Map<string, UsageRow>();
    try {
      const rows = await this.json<UsageRow[]>("/rest/v1/rpc/admin_user_usage", { method: "POST", body: "{}" });
      usage = new Map(rows.map((r) => [r.user_id, r]));
    } catch {
      // the function isn't installed yet: still list the accounts
    }
    const users = all.map((u): AdminUser => {
      const r = usage.get(u.id);
      return {
        email: u.email ?? "",
        provider: u.app_metadata?.provider ?? "email",
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        contactOk: u.user_metadata?.contact_ok === true,
        contactConsentAt: typeof u.user_metadata?.contact_consent_at === "string" ? u.user_metadata.contact_consent_at : null,
        saved: Number(r?.saved_count ?? 0),
        history: Number(r?.history_count ?? 0),
        bytes: Number(r?.bytes_used ?? 0),
        lastActivity: r?.last_activity ?? null,
      };
    });
    this.cache = { at: Date.now(), users };
    return users;
  }
}

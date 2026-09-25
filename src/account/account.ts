import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  DEFAULT_ITERATIONS, type KeyRecord, createVault, nonExtractableCopy, rewrapWithNewRecoveryCode, rewrapWithPassphrase,
  unlockWithPassphrase, unlockWithRecoveryCode,
} from "./crypto";
import { idb } from "./idb";
import { type CloudRepo, type CloudRow, CloudLibrary, type ItemKind } from "./library";

export type AccountStatus = "signed-out" | "needs-setup" | "locked" | "unlocked";

export interface AccountUser {
  id: string;
  email: string;
  provider: string;
  /** Whether they're happy to hear about other apps; null until they've chosen. */
  contactOk: boolean | null;
}

/** The wording next to the checkbox, stored with each choice as a record of what was agreed to. */
export const CONTACT_TEXT = "Email me now and then about other free apps I'm building. You can turn this off any time.";
const CONTACT_PENDING = "tc-contact-choice";

/** Keep the sign-in dialog's choice until the sign-in (a redirect) comes back. */
export function rememberContactChoice(ok: boolean): void {
  try {
    localStorage.setItem(CONTACT_PENDING, JSON.stringify({ ok }));
  } catch {
    /* private mode: the choice can still be made in account settings */
  }
}

function takeContactChoice(): boolean | null {
  try {
    const raw = localStorage.getItem(CONTACT_PENDING);
    localStorage.removeItem(CONTACT_PENDING);
    const v = raw ? (JSON.parse(raw) as { ok?: unknown }).ok : null;
    return typeof v === "boolean" ? v : null;
  } catch {
    return null;
  }
}

/**
 * The sign-in dialog's choice only applies to an account that hasn't chosen yet,
 * so signing in again can never switch back on emails someone turned off.
 */
export function contactChoiceToApply(existing: boolean | null, pending: boolean | null): boolean | null {
  return existing === null ? pending : null;
}

export interface Usage {
  bytesUsed: number;
  savedCount: number;
  historyCount: number;
}

export const QUOTA_BYTES = 100 * 1024 * 1024;

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

/** Accounts are only offered when the site was built with Supabase settings. */
export const accountsEnabled = Boolean(url && anonKey);

function friendly(error: { message?: string; hint?: string | null } | null): Error {
  if (!error) return new Error("Something went wrong. Please try again.");
  if (error.hint === "quota_bytes" || error.hint === "quota_items") return new Error(error.message);
  if (/fetch|network/i.test(error.message ?? "")) return new Error("Couldn't reach the server. Check your connection and try again.");
  return new Error(error.message || "Something went wrong. Please try again.");
}

class SupabaseRepo implements CloudRepo {
  constructor(private db: SupabaseClient) {}

  async listMeta(kind: ItemKind) {
    const { data, error } = await this.db
      .from("items")
      .select("id, kind, meta_iv, meta_ct, size_bytes, created_at, updated_at")
      .eq("kind", kind)
      .order("updated_at", { ascending: false })
      .limit(1000);
    if (error) throw friendly(error);
    return data as Omit<CloudRow, "body_iv" | "body_ct">[];
  }

  async getRow(id: string) {
    const { data, error } = await this.db.from("items").select("*").eq("id", id).maybeSingle();
    if (error) throw friendly(error);
    return data as CloudRow | null;
  }

  async upsert(row: Pick<CloudRow, "id" | "kind" | "meta_iv" | "meta_ct" | "body_iv" | "body_ct">) {
    const { error } = await this.db.from("items").upsert(row);
    if (error) throw friendly(error);
  }

  async updateMeta(id: string, meta_iv: string, meta_ct: string) {
    const { error } = await this.db.from("items").update({ meta_iv, meta_ct }).eq("id", id);
    if (error) throw friendly(error);
  }

  async remove(id: string) {
    const { error } = await this.db.from("items").delete().eq("id", id);
    if (error) throw friendly(error);
  }

  async removeAll() {
    const { error } = await this.db.rpc("delete_my_data", { forget_key: false });
    if (error) throw friendly(error);
  }
}

/** Sign-in, the passphrase lock, and account-wide actions. */
export class Account {
  status: AccountStatus = "signed-out";
  user: AccountUser | null = null;
  library: CloudLibrary | null = null;

  private db!: SupabaseClient;
  private record: KeyRecord | null = null;
  private listeners = new Set<() => void>();

  /** Load Supabase and restore any existing session. */
  static async start(): Promise<Account | null> {
    if (!accountsEnabled) return null;
    const { createClient } = await import("@supabase/supabase-js");
    const account = new Account();
    account.db = createClient(url!, anonKey!, {
      auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const { data } = await account.db.auth.getSession();
    await account.adopt(data.session?.user ?? null);
    account.db.auth.onAuthStateChange((_event, session) => {
      const next = session?.user ?? null;
      if (next?.id !== account.user?.id) void account.adopt(next);
    });
    return account;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private async adopt(user: User | null) {
    this.library = null;
    this.record = null;
    if (!user) {
      this.user = null;
      this.status = "signed-out";
      this.emit();
      return;
    }
    const contact = user.user_metadata?.contact_ok;
    this.user = {
      id: user.id,
      email: user.email ?? "",
      provider: String(user.app_metadata?.provider ?? "email"),
      contactOk: typeof contact === "boolean" ? contact : null,
    };
    const choice = contactChoiceToApply(this.user.contactOk, takeContactChoice());
    if (choice !== null) await this.setContactOk(choice).catch(() => {});
    try {
      await this.loadRecord();
    } catch {
      this.record = null;
    }
    if (!this.record) this.status = "needs-setup";
    else {
      const saved = await idb.get<CryptoKey>("keys", user.id).catch(() => undefined);
      if (saved) this.useKey(saved);
      else this.status = "locked";
    }
    this.emit();
  }

  private async loadRecord() {
    const { data, error } = await this.db.from("user_keys").select("*").maybeSingle();
    if (error) throw friendly(error);
    this.record = (data as KeyRecord | null) ?? null;
  }

  private useKey(key: CryptoKey) {
    this.library = new CloudLibrary(new SupabaseRepo(this.db), key);
    this.status = "unlocked";
  }

  private async remember(key: CryptoKey, keep: boolean) {
    if (keep) await idb.put("keys", await nonExtractableCopy(key), this.user!.id).catch(() => {});
    else await idb.delete("keys", this.user!.id).catch(() => {});
  }

  // ---------------------------------------------------------------- sign in and out

  async signInWithGoogle(): Promise<void> {
    const { error } = await this.db.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) throw friendly(error);
  }

  async signInWithEmail(email: string): Promise<void> {
    const { error } = await this.db.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true },
    });
    if (error) throw friendly(error);
  }

  /** Record whether they're happy to be emailed about other apps, with when and the wording shown. */
  async setContactOk(ok: boolean): Promise<void> {
    const { error } = await this.db.auth.updateUser({
      data: { contact_ok: ok, contact_consent_at: new Date().toISOString(), contact_consent_text: CONTACT_TEXT },
    });
    if (error) throw friendly(error);
    if (this.user) this.user.contactOk = ok;
  }

  async signOut(): Promise<void> {
    if (this.user) await idb.delete("keys", this.user.id).catch(() => {});
    await this.db.auth.signOut();
    await this.adopt(null);
  }

  // ---------------------------------------------------------------- the passphrase lock

  /** First sign-in: create the encryption key. Returns the recovery code to show once. */
  async setUp(passphrase: string, keepUnlocked: boolean): Promise<string> {
    const { record, key, recoveryCode } = await createVault(passphrase, this.user!.id, DEFAULT_ITERATIONS);
    const { error } = await this.db.from("user_keys").insert({ user_id: this.user!.id, ...record });
    if (error) throw friendly(error);
    this.record = record;
    await this.remember(key, keepUnlocked);
    this.useKey(key);
    this.emit();
    return recoveryCode;
  }

  async unlock(passphrase: string, keepUnlocked: boolean): Promise<void> {
    if (!this.record) await this.loadRecord();
    const key = await unlockWithPassphrase(this.record!, passphrase, this.user!.id);
    await this.remember(key, keepUnlocked);
    this.useKey(key);
    this.emit();
  }

  async unlockWithRecovery(code: string, keepUnlocked: boolean): Promise<void> {
    if (!this.record) await this.loadRecord();
    const key = await unlockWithRecoveryCode(this.record!, code, this.user!.id);
    await this.remember(key, keepUnlocked);
    this.useKey(key);
    this.emit();
  }

  async lock(): Promise<void> {
    if (this.user) await idb.delete("keys", this.user.id).catch(() => {});
    this.library = null;
    this.status = this.user ? "locked" : "signed-out";
    this.emit();
  }

  /** Change the passphrase. The current one (or the recovery code) proves it's really the user. */
  async changePassphrase(current: string, next: string, currentIsRecoveryCode = false): Promise<void> {
    const key = currentIsRecoveryCode
      ? await unlockWithRecoveryCode(this.record!, current, this.user!.id)
      : await unlockWithPassphrase(this.record!, current, this.user!.id);
    const columns = await rewrapWithPassphrase(key, next, this.user!.id);
    const { error } = await this.db.from("user_keys").update(columns).eq("user_id", this.user!.id);
    if (error) throw friendly(error);
    this.record = { ...this.record!, ...columns };
  }

  /** Replace the recovery code. Returns the new code to show once. */
  async newRecoveryCode(passphrase: string): Promise<string> {
    const key = await unlockWithPassphrase(this.record!, passphrase, this.user!.id);
    const { code, columns } = await rewrapWithNewRecoveryCode(key, this.user!.id);
    const { error } = await this.db.from("user_keys").update(columns).eq("user_id", this.user!.id);
    if (error) throw friendly(error);
    this.record = { ...this.record!, ...columns };
    return code;
  }

  // ---------------------------------------------------------------- account-wide actions

  async usage(): Promise<Usage> {
    const { data, error } = await this.db.rpc("my_usage");
    if (error) throw friendly(error);
    const row = (Array.isArray(data) ? data[0] : data) ?? {};
    return { bytesUsed: Number(row.bytes_used ?? 0), savedCount: Number(row.saved_count ?? 0), historyCount: Number(row.history_count ?? 0) };
  }

  /** Every saved comparison and history item, decrypted, for download. */
  async exportAll(): Promise<object> {
    const lib = this.library!;
    const out: object[] = [];
    for (const kind of ["saved", "history"] as const) {
      for (const item of await lib.list(kind)) out.push({ ...item, body: await lib.load(item.id) });
    }
    return { exportedAt: new Date().toISOString(), account: this.user?.email, items: out };
  }

  /** Delete every saved comparison. With forgetKey the passphrase is reset too. */
  async deleteAllData(forgetKey: boolean): Promise<void> {
    const { error } = await this.db.rpc("delete_my_data", { forget_key: forgetKey });
    if (error) throw friendly(error);
    if (forgetKey) {
      await idb.delete("keys", this.user!.id).catch(() => {});
      this.record = null;
        this.library = null;
      this.status = "needs-setup";
    }
    this.emit();
  }

  async deleteAccount(): Promise<void> {
    const { error } = await this.db.rpc("delete_my_account");
    if (error) throw friendly(error);
    if (this.user) await idb.delete("keys", this.user.id).catch(() => {});
    await this.db.auth.signOut({ scope: "local" }).catch(() => {});
    await this.adopt(null);
  }
}

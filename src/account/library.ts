import type { CompareOptions } from "../normalize";
import { decryptJson, encryptJson } from "./crypto";
import { idb } from "./idb";

export type ItemKind = "history" | "saved";

/** Small summary shown in lists. Encrypted separately from the texts in the cloud. */
export interface ComparisonMeta {
  title: string;
  nameA: string;
  nameB: string;
  linesA: number;
  linesB: number;
  preview: string;
}

/** Everything needed to reopen a comparison. */
export interface ComparisonBody {
  a: string;
  b: string;
  nameA: string;
  nameB: string;
  options?: CompareOptions;
  lang?: string;
}

export interface LibraryItem {
  id: string;
  kind: ItemKind;
  meta: ComparisonMeta;
  createdAt: string;
  updatedAt: string;
  size: number;
  where: "cloud" | "device";
}

export interface NewItem {
  id: string;
  kind: ItemKind;
  meta: ComparisonMeta;
  body: ComparisonBody;
}

export interface Library {
  readonly where: "cloud" | "device";
  list(kind: ItemKind): Promise<LibraryItem[]>;
  load(id: string): Promise<ComparisonBody>;
  put(item: NewItem): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

// ------------------------------------------------------------------ this device

const DEVICE_HISTORY_LIMIT = 50;

interface DeviceRecord extends NewItem {
  createdAt: string;
  updatedAt: string;
  size: number;
}

/** Comparisons kept in this browser only (IndexedDB), for visitors who aren't signed in. */
export class DeviceLibrary implements Library {
  readonly where = "device";

  async list(kind: ItemKind): Promise<LibraryItem[]> {
    const all = (await idb.all<DeviceRecord>("items")).filter((r) => r.kind === kind);
    all.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
    return all.map((r) => ({ id: r.id, kind: r.kind, meta: r.meta, createdAt: r.createdAt, updatedAt: r.updatedAt, size: r.size, where: "device" }));
  }

  async load(id: string): Promise<ComparisonBody> {
    const r = await idb.get<DeviceRecord>("items", id);
    if (!r) throw new Error("That comparison is no longer here.");
    return r.body;
  }

  async put(item: NewItem): Promise<void> {
    const old = await idb.get<DeviceRecord>("items", item.id);
    const now = new Date().toISOString();
    const size = item.body.a.length + item.body.b.length;
    await idb.put("items", { ...item, createdAt: old?.createdAt ?? now, updatedAt: now, size } satisfies DeviceRecord);
    if (item.kind === "history") {
      const history = await this.list("history");
      for (const extra of history.slice(DEVICE_HISTORY_LIMIT)) await idb.delete("items", extra.id);
    }
  }

  async rename(id: string, title: string): Promise<void> {
    const r = await idb.get<DeviceRecord>("items", id);
    if (r) await idb.put("items", { ...r, meta: { ...r.meta, title } });
  }

  remove(id: string): Promise<void> {
    return idb.delete("items", id).then(() => undefined);
  }

  clear(): Promise<void> {
    return idb.clear("items").then(() => undefined);
  }
}

// ------------------------------------------------------------------ encrypted account

/** A row of the items table, exactly as stored on the server. */
export interface CloudRow {
  id: string;
  kind: ItemKind;
  meta_iv: string;
  meta_ct: string;
  body_iv: string;
  body_ct: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

/** The server operations the cloud library needs (Supabase in the app, a fake in tests). */
export interface CloudRepo {
  listMeta(kind: ItemKind): Promise<Omit<CloudRow, "body_iv" | "body_ct">[]>;
  getRow(id: string): Promise<CloudRow | null>;
  upsert(row: Pick<CloudRow, "id" | "kind" | "meta_iv" | "meta_ct" | "body_iv" | "body_ct">): Promise<void>;
  updateMeta(id: string, meta_iv: string, meta_ct: string): Promise<void>;
  remove(id: string): Promise<void>;
  removeAll(): Promise<void>;
}

const metaAad = (id: string) => `item:${id}:meta`;
const bodyAad = (id: string) => `item:${id}:body`;

/** Comparisons in the user's account, encrypted and decrypted in the browser. */
export class CloudLibrary implements Library {
  readonly where = "cloud";

  constructor(private repo: CloudRepo, private key: CryptoKey) {}

  async list(kind: ItemKind): Promise<LibraryItem[]> {
    const rows = await this.repo.listMeta(kind);
    const items = await Promise.all(
      rows.map(async (r): Promise<LibraryItem | null> => {
        try {
          const meta = await decryptJson<ComparisonMeta>(this.key, { iv: r.meta_iv, ct: r.meta_ct }, metaAad(r.id));
          return { id: r.id, kind: r.kind, meta, createdAt: r.created_at, updatedAt: r.updated_at, size: r.size_bytes, where: "cloud" };
        } catch {
          return null; // unreadable (e.g. tampered) rows are left out rather than breaking the list
        }
      }),
    );
    return items.filter((i): i is LibraryItem => i !== null);
  }

  async load(id: string): Promise<ComparisonBody> {
    const row = await this.repo.getRow(id);
    if (!row) throw new Error("That comparison is no longer in your account.");
    return decryptJson<ComparisonBody>(this.key, { iv: row.body_iv, ct: row.body_ct }, bodyAad(id));
  }

  async put(item: NewItem): Promise<void> {
    const [meta, body] = await Promise.all([
      encryptJson(this.key, item.meta, metaAad(item.id)),
      encryptJson(this.key, item.body, bodyAad(item.id)),
    ]);
    await this.repo.upsert({ id: item.id, kind: item.kind, meta_iv: meta.iv, meta_ct: meta.ct, body_iv: body.iv, body_ct: body.ct });
  }

  async rename(id: string, title: string): Promise<void> {
    const row = await this.repo.getRow(id);
    if (!row) return;
    const meta = await decryptJson<ComparisonMeta>(this.key, { iv: row.meta_iv, ct: row.meta_ct }, metaAad(id));
    const box = await encryptJson(this.key, { ...meta, title }, metaAad(id));
    await this.repo.updateMeta(id, box.iv, box.ct);
  }

  remove(id: string): Promise<void> {
    return this.repo.remove(id);
  }

  clear(): Promise<void> {
    return this.repo.removeAll();
  }
}

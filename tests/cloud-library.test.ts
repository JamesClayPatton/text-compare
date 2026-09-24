import { describe, expect, it } from "vitest";
import { createVault } from "../src/account/crypto";
import { CloudLibrary, type CloudRepo, type CloudRow } from "../src/account/library";

/** In-memory stand-in for the Supabase table, keeping rows exactly as the server would. */
class FakeRepo implements CloudRepo {
  rows = new Map<string, CloudRow>();
  async listMeta(kind: "history" | "saved") {
    return [...this.rows.values()].filter((r) => r.kind === kind).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  async getRow(id: string) {
    return this.rows.get(id) ?? null;
  }
  async upsert(row: Omit<CloudRow, "size_bytes" | "created_at" | "updated_at">) {
    const now = new Date(Date.now() + this.rows.size).toISOString();
    const old = this.rows.get(row.id);
    this.rows.set(row.id, { ...row, size_bytes: row.meta_ct.length + row.body_ct.length, created_at: old?.created_at ?? now, updated_at: now });
  }
  async updateMeta(id: string, meta_iv: string, meta_ct: string) {
    const r = this.rows.get(id)!;
    this.rows.set(id, { ...r, meta_iv, meta_ct });
  }
  async remove(id: string) {
    this.rows.delete(id);
  }
  async removeAll() {
    this.rows.clear();
  }
}

const meta = { title: "Contract v2 vs v3", nameA: "v2.docx", nameB: "v3.docx", linesA: 2, linesB: 2, preview: "Parties agree" };
const body = { a: "Parties agree to pay $100.", b: "Parties agree to pay $150.", nameA: "v2.docx", nameB: "v3.docx" };

async function setup() {
  const repo = new FakeRepo();
  const { key } = await createVault("a long passphrase", "user-1", 100_000);
  return { repo, lib: new CloudLibrary(repo, key) };
}

describe("CloudLibrary", () => {
  it("stores only ciphertext and reads it back", async () => {
    const { repo, lib } = await setup();
    await lib.put({ id: "11111111-1111-4111-8111-111111111111", kind: "saved", meta, body });
    const row = [...repo.rows.values()][0];
    const stored = JSON.stringify(row);
    for (const secret of ["Contract", "v2.docx", "Parties", "$150"]) expect(stored).not.toContain(secret);

    const items = await lib.list("saved");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: row.id, kind: "saved", where: "cloud", meta });
    expect(await lib.load(row.id)).toEqual(body);
  });

  it("renames without touching the saved texts", async () => {
    const { repo, lib } = await setup();
    const id = "22222222-2222-4222-8222-222222222222";
    await lib.put({ id, kind: "saved", meta, body });
    const bodyBefore = repo.rows.get(id)!.body_ct;
    await lib.rename(id, "Final contract check");
    expect((await lib.list("saved"))[0].meta.title).toBe("Final contract check");
    expect(repo.rows.get(id)!.body_ct).toBe(bodyBefore);
  });

  it("refuses rows whose ciphertext was swapped between items", async () => {
    const { repo, lib } = await setup();
    const a = "33333333-3333-4333-8333-333333333333";
    const b = "44444444-4444-4444-8444-444444444444";
    await lib.put({ id: a, kind: "saved", meta, body });
    await lib.put({ id: b, kind: "saved", meta: { ...meta, title: "Other" }, body: { ...body, a: "other" } });
    repo.rows.set(a, { ...repo.rows.get(a)!, body_iv: repo.rows.get(b)!.body_iv, body_ct: repo.rows.get(b)!.body_ct });
    await expect(lib.load(a)).rejects.toThrow();
  });

  it("skips unreadable rows in lists instead of failing the whole list", async () => {
    const { repo, lib } = await setup();
    await lib.put({ id: "55555555-5555-4555-8555-555555555555", kind: "history", meta, body });
    repo.rows.set("66666666-6666-4666-8666-666666666666", { ...[...repo.rows.values()][0], id: "66666666-6666-4666-8666-666666666666" });
    const items = await lib.list("history");
    expect(items.map((i) => i.id)).toEqual(["55555555-5555-4555-8555-555555555555"]);
  });

  it("removes one item or everything", async () => {
    const { repo, lib } = await setup();
    await lib.put({ id: "77777777-7777-4777-8777-777777777777", kind: "saved", meta, body });
    await lib.put({ id: "88888888-8888-4888-8888-888888888888", kind: "history", meta, body });
    await lib.remove("77777777-7777-4777-8777-777777777777");
    expect(repo.rows.size).toBe(1);
    await lib.clear();
    expect(repo.rows.size).toBe(0);
  });
});

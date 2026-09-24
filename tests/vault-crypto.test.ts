import { describe, expect, it } from "vitest";
import {
  WrongSecretError, createVault, decryptJson, encryptJson, newRecoveryCode, rewrapWithPassphrase, unlockWithPassphrase,
  unlockWithRecoveryCode,
} from "../src/account/crypto";

const FAST = 100_000; // the schema's minimum; keeps tests quick

describe("vault keys", () => {
  it("creates a wrapped key that unlocks with the passphrase", async () => {
    const { record, key, recoveryCode } = await createVault("correct horse battery staple", "user-1", FAST);
    expect(record.kdf_iterations).toBe(FAST);
    expect(record.wrapped_key).not.toContain("correct");
    expect(recoveryCode).toMatch(/^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);

    const again = await unlockWithPassphrase(record, "correct horse battery staple", "user-1");
    const box = await encryptJson(key, { hello: "world" }, "aad");
    expect(await decryptJson(again, box, "aad")).toEqual({ hello: "world" });
  });

  it("rejects a wrong passphrase or a key record from another user", async () => {
    const { record } = await createVault("right passphrase", "user-1", FAST);
    await expect(unlockWithPassphrase(record, "wrong passphrase", "user-1")).rejects.toBeInstanceOf(WrongSecretError);
    await expect(unlockWithPassphrase(record, "right passphrase", "user-2")).rejects.toBeInstanceOf(WrongSecretError);
  });

  it("unlocks with the recovery code, ignoring case and dashes", async () => {
    const { record, key, recoveryCode } = await createVault("pass phrase one", "u", FAST);
    const typed = recoveryCode.toLowerCase().replace(/-/g, " ");
    const recovered = await unlockWithRecoveryCode(record, typed, "u");
    const box = await encryptJson(key, [1, 2, 3], "x");
    expect(await decryptJson(recovered, box, "x")).toEqual([1, 2, 3]);
    await expect(unlockWithRecoveryCode(record, newRecoveryCode(), "u")).rejects.toBeInstanceOf(WrongSecretError);
  });

  it("changes the passphrase without changing the data key", async () => {
    const { record, key } = await createVault("old passphrase", "u", FAST);
    const box = await encryptJson(key, "secret text", "a");
    const changed = { ...record, ...(await rewrapWithPassphrase(key, "new passphrase", "u", FAST)) };
    await expect(unlockWithPassphrase(changed, "old passphrase", "u")).rejects.toBeInstanceOf(WrongSecretError);
    const unlocked = await unlockWithPassphrase(changed, "new passphrase", "u");
    expect(await decryptJson(unlocked, box, "a")).toBe("secret text");
  });
});

describe("encrypted items", () => {
  it("round-trips large text with compression and never stores plaintext", async () => {
    const { key } = await createVault("p4ssphrase!", "u", FAST);
    const text = "the same line again\n".repeat(20000);
    const box = await encryptJson(key, { a: text, b: text + "!" }, "item-1:body");
    expect(box.ct.length).toBeLessThan(text.length / 10);
    expect(box.ct).not.toContain("same line");
    expect(await decryptJson(key, box, "item-1:body")).toEqual({ a: text, b: text + "!" });
  });

  it("fails if a ciphertext is moved to another item", async () => {
    const { key } = await createVault("p4ssphrase!", "u", FAST);
    const box = await encryptJson(key, "x", "item-1:body");
    await expect(decryptJson(key, box, "item-2:body")).rejects.toBeInstanceOf(WrongSecretError);
  });

  it("uses a fresh IV every time", async () => {
    const { key } = await createVault("p4ssphrase!", "u", FAST);
    const a = await encryptJson(key, "same", "z");
    const b = await encryptJson(key, "same", "z");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });
});

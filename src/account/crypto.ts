// End-to-end encryption for saved comparisons.
//
// Each user has one random 256-bit AES-GCM data key. It never leaves the
// browser unencrypted: the server stores it wrapped (encrypted) with a key
// derived from the user's passphrase (PBKDF2-SHA256), and optionally a second
// copy wrapped with a one-time recovery code. Saved items are compressed, then
// encrypted with the data key; each ciphertext is bound to its item and part
// through AES-GCM additional data, so rows can't be swapped around.

export const DEFAULT_ITERATIONS = 600_000; // OWASP guidance for PBKDF2-SHA256
const RECOVERY_ITERATIONS = 100_000; // recovery codes are random, so fewer rounds are fine

export class WrongSecretError extends Error {
  constructor() {
    super("That passphrase or recovery code doesn't match.");
  }
}

/** The wrapped-key columns of the user_keys table. */
export interface KeyRecord {
  kdf_iterations: number;
  kdf_salt: string;
  wrapped_key: string;
  wrap_iv: string;
  recovery_salt: string | null;
  recovery_wrapped_key: string | null;
  recovery_iv: string | null;
}

export interface Box {
  iv: string;
  ct: string;
}

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

// ------------------------------------------------------------------ base64

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// ------------------------------------------------------------------ recovery codes

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I

/** 32 characters from a 32-symbol alphabet: 160 bits, shown as 8 groups of 4. */
export function newRecoveryCode(): string {
  const bytes = random(32);
  const chars = Array.from(bytes, (b) => ALPHABET[b & 31]).join("");
  return chars.match(/.{4}/g)!.join("-");
}

function normaliseRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ------------------------------------------------------------------ keys

async function deriveWrappingKey(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function wrap(raw: Uint8Array<ArrayBuffer>, secret: string, iterations: number, userId: string) {
  const salt = random(16);
  const iv = random(12);
  const kek = await deriveWrappingKey(secret, salt, iterations);
  const wrapped = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(`key:${userId}`) }, kek, raw));
  return { salt: toB64(salt), iv: toB64(iv), wrapped: toB64(wrapped) };
}

async function unwrap(wrapped: string, iv: string, salt: string, secret: string, iterations: number, userId: string): Promise<CryptoKey> {
  const kek = await deriveWrappingKey(secret, fromB64(salt), iterations);
  let raw: ArrayBuffer;
  try {
    raw = await subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv), additionalData: enc.encode(`key:${userId}`) }, kek, fromB64(wrapped));
  } catch {
    throw new WrongSecretError();
  }
  // extractable so the passphrase can later be changed (the key is re-wrapped, never sent in the clear)
  return subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
}

/** Make a new data key for a user, wrapped with their passphrase and a new recovery code. */
export async function createVault(passphrase: string, userId: string, iterations = DEFAULT_ITERATIONS) {
  const raw = random(32);
  const recoveryCode = newRecoveryCode();
  const main = await wrap(raw, passphrase, iterations, userId);
  const rec = await wrap(raw, normaliseRecoveryCode(recoveryCode), RECOVERY_ITERATIONS, userId);
  const record: KeyRecord = {
    kdf_iterations: iterations,
    kdf_salt: main.salt,
    wrapped_key: main.wrapped,
    wrap_iv: main.iv,
    recovery_salt: rec.salt,
    recovery_wrapped_key: rec.wrapped,
    recovery_iv: rec.iv,
  };
  const key = await subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
  raw.fill(0);
  return { record, key, recoveryCode };
}

export function unlockWithPassphrase(record: KeyRecord, passphrase: string, userId: string): Promise<CryptoKey> {
  return unwrap(record.wrapped_key, record.wrap_iv, record.kdf_salt, passphrase, record.kdf_iterations, userId);
}

export function unlockWithRecoveryCode(record: KeyRecord, code: string, userId: string): Promise<CryptoKey> {
  if (!record.recovery_wrapped_key || !record.recovery_iv || !record.recovery_salt) return Promise.reject(new WrongSecretError());
  return unwrap(record.recovery_wrapped_key, record.recovery_iv, record.recovery_salt, normaliseRecoveryCode(code), RECOVERY_ITERATIONS, userId);
}

/** New passphrase columns for the same data key. */
export async function rewrapWithPassphrase(key: CryptoKey, passphrase: string, userId: string, iterations = DEFAULT_ITERATIONS) {
  const raw = new Uint8Array(await subtle.exportKey("raw", key));
  const w = await wrap(raw, passphrase, iterations, userId);
  raw.fill(0);
  return { kdf_iterations: iterations, kdf_salt: w.salt, wrapped_key: w.wrapped, wrap_iv: w.iv };
}

/** New recovery-code columns for the same data key. */
export async function rewrapWithNewRecoveryCode(key: CryptoKey, userId: string) {
  const raw = new Uint8Array(await subtle.exportKey("raw", key));
  const code = newRecoveryCode();
  const w = await wrap(raw, normaliseRecoveryCode(code), RECOVERY_ITERATIONS, userId);
  raw.fill(0);
  return { code, columns: { recovery_salt: w.salt, recovery_wrapped_key: w.wrapped, recovery_iv: w.iv } };
}

/** A copy of the key that can't be exported, for keeping the vault unlocked on this device. */
export async function nonExtractableCopy(key: CryptoKey): Promise<CryptoKey> {
  const raw = new Uint8Array(await subtle.exportKey("raw", key));
  const copy = await subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  raw.fill(0);
  return copy;
}

// ------------------------------------------------------------------ items

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Compress and encrypt any JSON value. `aad` ties the ciphertext to where it is stored. */
export async function encryptJson(key: CryptoKey, value: unknown, aad: string): Promise<Box> {
  const packed = await pipe(enc.encode(JSON.stringify(value)), new CompressionStream("gzip"));
  const iv = random(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, packed));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptJson<T = unknown>(key: CryptoKey, box: Box, aad: string): Promise<T> {
  let packed: ArrayBuffer;
  try {
    packed = await subtle.decrypt({ name: "AES-GCM", iv: fromB64(box.iv), additionalData: enc.encode(aad) }, key, fromB64(box.ct));
  } catch {
    throw new WrongSecretError();
  }
  return JSON.parse(dec.decode(await pipe(new Uint8Array(packed), new DecompressionStream("gzip"))));
}

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Envelope-free AES-256-GCM for statement originals at rest.
 *
 * Key: `STATEMENT_ENCRYPTION_KEY`, 32 random bytes, base64. Generate with
 *   openssl rand -base64 32
 * GCM gives confidentiality + integrity: a tampered blob fails to decrypt
 * rather than yielding garbage. The statement id is bound in as AAD so a blob
 * can't be swapped onto another statement's row.
 *
 * Rotation path: add a key id prefix to storageKey and keep old keys for decrypt.
 */
const ALGO = "aes-256-gcm";

function loadKey(): Buffer {
  const b64 = process.env.STATEMENT_ENCRYPTION_KEY;
  if (!b64) throw new Error("STATEMENT_ENCRYPTION_KEY is not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("STATEMENT_ENCRYPTION_KEY must be 32 bytes (base64)");
  return key;
}

export interface Encrypted {
  ciphertext: Buffer;
  iv: string; // base64
  tag: string; // base64
}

export function encrypt(plaintext: Uint8Array, aad: string, key = loadKey()): Encrypted {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function decrypt(enc: Encrypted, aad: string, key = loadKey()): Buffer {
  const decipher = createDecipheriv(ALGO, key, Buffer.from(enc.iv, "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
  return Buffer.concat([decipher.update(enc.ciphertext), decipher.final()]);
}

/** Tokens (sessions, magic links, invites) are stored hashed; compare in constant time. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

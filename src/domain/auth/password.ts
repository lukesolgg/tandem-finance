import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * PIN / secret hashing with scrypt (node:crypto — no native addon to compile in
 * Docker). Parameters follow OWASP's scrypt guidance (N=2^17, r=8, p=1).
 * Format: scrypt$N$r$p$salt$hash (base64) so parameters can be raised later
 * and old hashes still verify.
 */
const N = 1 << 17;
const R = 8;
const P = 1;
const KEYLEN = 32;

function scrypt(pw: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const opts: ScryptOptions = { N: n, r, p, maxmem: 256 * n * r };
  return new Promise((res, rej) => scryptCb(pw.normalize("NFKC"), salt, KEYLEN, opts, (e, k) => (e ? rej(e) : res(k))));
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // Burn comparable time so "no such user" isn't distinguishable by timing.
    await scrypt(pw, randomBytes(16), N, R, P);
    return false;
  }
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const got = await scrypt(pw, Buffer.from(salt, "base64"), +n, +r, +p);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/**
 * PINs are exactly 8 digits (10^8 combinations). On their own that's guessable
 * by a script, so they're only safe together with the lockout in
 * `household/service.ts` (5 tries → 15 minutes), which caps an attacker at
 * ~480 guesses a day: ~570 years on average to find a PIN.
 */
export const PIN_LENGTH = 8;

export function pinProblem(pin: string): string | null {
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) return `Your PIN must be exactly ${PIN_LENGTH} digits.`;
  if (/^(\d)\1+$/.test(pin)) return "Avoid a PIN that's all the same digit.";
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]!);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return "Avoid a sequence like 12345678.";
  if (/^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(pin) || /^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(19|20)\d{2}$/.test(pin)) {
    return "Avoid using a date (like a birthday) — it's the first thing someone would try.";
  }
  return null;
}

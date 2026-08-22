import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing.
 *
 * scrypt from node:crypto rather than a dependency: it is memory-hard, it is in
 * the standard library, and adding bcrypt or argon2 would mean a native build
 * step for a function that is thirty lines.
 *
 * Runs only on the server. `lib/operator.ts` uses Web Crypto because it also
 * runs in middleware; this never does.
 */

/** OWASP's floor for scrypt at the time of writing. */
const COST = 2 ** 16;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return { hash: derived.toString("hex"), salt };
}

/**
 * Verify a password against a stored hash.
 *
 * Compared in constant time. Returns false rather than throwing on a malformed
 * stored hash, because a corrupt record must not be distinguishable from a
 * wrong password by anyone probing from outside.
 */
export async function verifyPassword(
  password: string,
  hash: string,
  salt: string,
): Promise<boolean> {
  if (hash === "" || salt === "") return false;
  try {
    const derived = await scrypt(password, salt, KEY_LENGTH);
    const stored = Buffer.from(hash, "hex");
    if (stored.length !== derived.length) return false;
    return timingSafeEqual(stored, derived);
  } catch {
    return false;
  }
}

export interface PasswordProblem {
  readonly ok: false;
  readonly reason: string;
}

/**
 * Minimum password requirements.
 *
 * Length only, deliberately. Composition rules — a digit, a symbol, a capital —
 * push people towards Password1! and are no longer recommended by NCSC or NIST.
 * Length is what actually costs an attacker.
 */
export function passwordProblem(password: string): PasswordProblem | undefined {
  if (password.length < 12) {
    return { ok: false, reason: "Use at least 12 characters. Length matters more than symbols." };
  }
  if (password.length > 512) {
    // Unbounded input into a deliberately slow hash is a denial-of-service.
    return { ok: false, reason: "That password is too long." };
  }
  return undefined;
}

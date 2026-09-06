import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * The options argument is part of the type on purpose.
 *
 * It was previously omitted, and that omission is what let a bug through
 * silently: `COST` was declared, commented as OWASP's floor, and never passed,
 * because the type made passing it impossible. Node then used its own default
 * of N=16384 and every hash was a quarter as expensive as the comment claimed.
 * A signature that cannot express a parameter is a signature that guarantees
 * the parameter is forgotten.
 */
const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number,
  options: { readonly N: number; readonly r: number; readonly p: number; readonly maxmem: number },
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
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;

/**
 * scrypt's memory cost is 128 * N * r, so N=65536 needs 64MB per hash.
 *
 * Node's own default ceiling is 32MB, so this has to be raised explicitly or
 * the call throws. The headroom is deliberate and the number is worth
 * understanding rather than copying: 64MB *per concurrent hash* is what makes
 * this expensive for an attacker, and it is also what would make it expensive
 * for us if anybody could ask for it without limit. They cannot — `rateLimit.ts`
 * caps sign-in attempts, and that limiter is not an optional companion to this
 * change but the thing that makes it safe.
 */
const MAX_MEMORY = 128 * COST * BLOCK_SIZE * 2;

const PARAMS = { N: COST, r: BLOCK_SIZE, p: PARALLELISM, maxmem: MAX_MEMORY } as const;

/**
 * What Node used when no options were passed.
 *
 * Every password hashed before this file was fixed was derived at these
 * parameters. They are kept so those hashes still verify — changing the cost
 * without them would lock out every existing account, which is a worse
 * outcome than the weakness being fixed.
 */
const LEGACY = { N: 16_384, r: 8, p: 1, maxmem: 128 * 16_384 * 8 * 2 } as const;

/**
 * Stored as `scrypt$N$r$p$<hex>`.
 *
 * The parameters travel with the hash because they will change again. A stored
 * digest with no record of how it was derived can only be verified by guessing,
 * and the guess that fails is indistinguishable from a wrong password.
 */
const PREFIX = "scrypt";

function encode(derived: Buffer): string {
  return `${PREFIX}$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${derived.toString("hex")}`;
}

interface Stored {
  readonly params: { readonly N: number; readonly r: number; readonly p: number; readonly maxmem: number };
  readonly digest: string;
  /** True where this hash predates the parameters being recorded. */
  readonly legacy: boolean;
}

function decode(hash: string): Stored | undefined {
  if (!hash.startsWith(`${PREFIX}$`)) {
    // No prefix: hashed before this change, at Node's defaults.
    return /^[0-9a-f]+$/i.test(hash)
      ? { params: LEGACY, digest: hash.toLowerCase(), legacy: true }
      : undefined;
  }

  const parts = hash.split("$");
  if (parts.length !== 5) return undefined;
  const [, n, r, p, digest] = parts;
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(R) || !Number.isSafeInteger(P)) {
    return undefined;
  }
  if (digest === undefined || !/^[0-9a-f]+$/i.test(digest)) return undefined;
  // A stored N is used to verify an existing hash, never to create one, so it
  // cannot be used to weaken a new password. It can still be used to demand an
  // absurd amount of memory, so it is bounded.
  if (N < 2 ** 10 || N > 2 ** 20 || R < 1 || R > 32 || P < 1 || P > 16) return undefined;

  return { params: { N, r: R, p: P, maxmem: 128 * N * R * 2 }, digest: digest.toLowerCase(), legacy: false };
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEY_LENGTH, PARAMS);
  return { hash: encode(derived), salt };
}

/**
 * True where this hash should be replaced next time the password is known.
 *
 * Upgrading cannot happen in the background — the plaintext is needed — so it
 * happens on a successful sign-in, which is the one moment it is available.
 */
export function needsRehash(hash: string): boolean {
  const stored = decode(hash);
  if (stored === undefined) return false;
  return stored.legacy || stored.params.N < COST;
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
  const parsed = decode(hash);
  if (parsed === undefined) return false;
  try {
    // Derived at the parameters this hash was created with, not at the current
    // ones. Verifying an old hash at a new cost produces a different digest and
    // refuses a correct password.
    const derived = await scrypt(password, salt, KEY_LENGTH, parsed.params);
    const stored = Buffer.from(parsed.digest, "hex");
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

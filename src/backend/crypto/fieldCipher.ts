import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Encryption for the fields that would be the worst thing to lose.
 *
 * This is **not** end-to-end encryption and must not be described as such. The
 * server decrypts these fields on every request, because the whole product is
 * arithmetic over them: Seller Protection reads the screening answers to decide
 * whether a deal is blocked, the motivation engine reads the narrative, and the
 * Deal Score depends on both. A key the server holds is a key an attacker who
 * owns the server holds. Real end-to-end encryption would mean the seller's
 * browser held the only key, and then nothing could be scored, matched or
 * protected — it would be a different product.
 *
 * What it does defend against is the realistic case, which is not "attacker
 * owns the running process" but "attacker has a copy of the database": a
 * stolen backup, a snapshot restored to the wrong place, a managed-database
 * console, a disk that left the building. In every one of those the ciphertext
 * is useless without `DATA_ENCRYPTION_KEY`, which lives in the process
 * environment and not in the data.
 *
 * AES-256-GCM, a fresh 96-bit IV per value, and the authentication tag stored
 * alongside. GCM is authenticated, so a modified ciphertext fails to decrypt
 * rather than decrypting to something else — which matters here because these
 * values decide whether a vulnerable seller's deal is blocked.
 */

const ALGORITHM = "aes-256-gcm";
/** 96 bits is the size GCM is specified for; longer is hashed and slower. */
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * The prefix that says what a stored value is.
 *
 * Present so a plaintext value and a ciphertext are told apart by looking
 * rather than by guessing, which is what makes it possible to turn encryption
 * on for a database that already has rows in it. The version number is there
 * so a future scheme can be introduced without a migration that has to
 * complete before anything works.
 */
const PREFIX = "enc.v1.";

export class MissingKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingKeyError";
  }
}

/**
 * The key, decoded and checked.
 *
 * Refuses a key of the wrong length rather than padding or hashing one to fit.
 * A short key silently stretched is the kind of thing that looks like it works
 * and quietly halves the strength, and there is no reason to accept one when
 * generating a correct key is a single command.
 */
export function readKey(raw: string | undefined = process.env.DATA_ENCRYPTION_KEY): Buffer | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  let key: Buffer;
  try {
    key = Buffer.from(raw.trim(), "base64");
  } catch {
    throw new MissingKeyError("DATA_ENCRYPTION_KEY is not valid base64.");
  }
  if (key.length !== KEY_BYTES) {
    throw new MissingKeyError(
      `DATA_ENCRYPTION_KEY decodes to ${key.length} bytes; ${KEY_BYTES} are required. Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

export function encryptionConfigured(raw: string | undefined = process.env.DATA_ENCRYPTION_KEY): boolean {
  return readKey(raw) !== undefined;
}

/** True where this value has already been through `encrypt`. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Encrypt one value, or return it unchanged where no key is configured.
 *
 * Returning plaintext is deliberate and is the reason `checkEncryption()` in
 * the preflight is a blocker. A development machine with no key has to work,
 * and a deployment with no key has to be refused loudly — doing it the other
 * way round, by throwing here, would mean the enquiry form 500s on a laptop
 * and nobody would notice the deployment problem until a seller did.
 */
export function encrypt(plaintext: string, key: Buffer | undefined = readKey()): string {
  if (key === undefined) return plaintext;
  // Encrypting twice would be a bug that only shows up as unreadable data.
  if (isEncrypted(plaintext)) return plaintext;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

/**
 * Decrypt one value, passing through anything that was never encrypted.
 *
 * The pass-through is what lets encryption be switched on for a database that
 * already holds rows: existing plaintext keeps being readable, and anything
 * written from then on is encrypted. `npm run encrypt:backfill` converts the
 * rest when somebody chooses to.
 */
export function decrypt(stored: string, key: Buffer | undefined = readKey()): string {
  if (!isEncrypted(stored)) return stored;
  if (key === undefined) {
    throw new MissingKeyError(
      "This record is encrypted and DATA_ENCRYPTION_KEY is not set. The data is intact; the key is missing.",
    );
  }

  const parts = stored.slice(PREFIX.length).split(".");
  const [ivPart, tagPart, bodyPart] = parts;
  if (parts.length !== 3 || ivPart === undefined || tagPart === undefined || bodyPart === undefined) {
    throw new MissingKeyError("Encrypted value is malformed.");
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  // Throws on a tag mismatch, which is the point: a tampered value must fail
  // rather than decrypt to something plausible. These values decide whether a
  // vulnerable seller's deal is blocked.
  return Buffer.concat([
    decipher.update(Buffer.from(bodyPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Whether two keys are the same, without leaking which byte differed.
 *
 * Used by the backfill to refuse to run with a key that is not the one the
 * data was written with.
 */
export function sameKey(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

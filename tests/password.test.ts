import { describe, expect, it } from "vitest";
import { scrypt as cb } from "node:crypto";
import { promisify } from "node:util";
import { hashPassword, needsRehash, verifyPassword } from "@backend/auth/password";

const scryptRaw = promisify(cb) as (p: string, s: string, k: number) => Promise<Buffer>;

/**
 * Password hashing, and the upgrade path.
 *
 * The bug this pins: `COST = 2 ** 16` was declared, commented as OWASP's
 * floor, and passed to neither scrypt call — because the promisified type did
 * not have a parameter for it. Node used its own default of N=16384 and every
 * hash was a quarter as expensive as the comment claimed.
 *
 * Fixing the cost without a migration would have locked out every existing
 * account, which is worse than the weakness. So the parameters travel with the
 * hash, old hashes still verify at the parameters they were made with, and
 * they are upgraded on the one occasion the plaintext is available.
 */

describe("hashes made before the fix", () => {
  it("still verify, so nobody is locked out", async () => {
    const salt = "0123456789abcdef";
    const legacy = (await scryptRaw("correct horse", salt, 64)).toString("hex");
    expect(await verifyPassword("correct horse", legacy, salt)).toBe(true);
    expect(await verifyPassword("wrong horse", legacy, salt)).toBe(false);
  });

  it("are flagged for replacement", async () => {
    const salt = "0123456789abcdef";
    const legacy = (await scryptRaw("correct horse", salt, 64)).toString("hex");
    expect(needsRehash(legacy)).toBe(true);
  });
});

describe("hashes made now", () => {
  it("record the parameters they were derived at", async () => {
    // A stored digest with no record of how it was derived can only be
    // verified by guessing, and a guess that fails is indistinguishable from a
    // wrong password.
    const { hash } = await hashPassword("correct horse");
    expect(hash.startsWith("scrypt$65536$8$1$")).toBe(true);
  });

  it("verify, reject a wrong password, and need no upgrade", async () => {
    const { hash, salt } = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", hash, salt)).toBe(true);
    expect(await verifyPassword("correct horses", hash, salt)).toBe(false);
    expect(needsRehash(hash)).toBe(false);
  });

  it("salt separately, so identical passwords do not collide", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("refusing what it cannot read", () => {
  it("rejects an empty or malformed stored hash rather than throwing", async () => {
    // A corrupt record must not be distinguishable from a wrong password by
    // anyone probing from outside.
    expect(await verifyPassword("x", "", "salt")).toBe(false);
    expect(await verifyPassword("x", "hash", "")).toBe(false);
    expect(await verifyPassword("x", "not-hex-at-all", "salt")).toBe(false);
    expect(await verifyPassword("x", "scrypt$nope$8$1$aabb", "salt")).toBe(false);
    expect(await verifyPassword("x", "scrypt$65536$8$aabb", "salt")).toBe(false);
  });

  it("bounds the stored parameters, so a record cannot demand absurd memory", async () => {
    // The stored N verifies an existing hash and can never create one, so it
    // cannot weaken a new password. It could still be used to ask for
    // gigabytes.
    expect(await verifyPassword("x", "scrypt$1073741824$8$1$aabb", "salt")).toBe(false);
    expect(await verifyPassword("x", "scrypt$65536$99$1$aabb", "salt")).toBe(false);
  });

  it("does not flag an unreadable hash for rehash", () => {
    // Rehashing something we cannot read would replace a record we do not
    // understand with one we do, silently, on a sign-in that should have failed.
    expect(needsRehash("not-a-hash-$$$")).toBe(false);
  });
});

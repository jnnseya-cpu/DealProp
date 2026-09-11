import { describe, expect, it } from "vitest";
import { openDeal, sealDeal, sealed } from "@backend/store/sealing";
import { decrypt, encrypt, isEncrypted, readKey, MissingKeyError } from "@backend/crypto/fieldCipher";
import { SEED_DEALS } from "@backend/store/seed";
import type { DealRecord, Store } from "@backend/store/schema";

/** A real 32-byte key, so the tests exercise the real cipher. */
const KEY = Buffer.alloc(32, 7).toString("base64");

/**
 * Async variant. The synchronous one restores the environment in `finally`,
 * which runs the moment an async body returns its promise rather than when it
 * settles — so the key was gone before the work that needed it ran. Worth
 * keeping both rather than making everything async: the sync version is the
 * honest shape for the sync tests.
 */
async function withKeyAsync<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.DATA_ENCRYPTION_KEY;
  process.env.DATA_ENCRYPTION_KEY = KEY;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = previous;
  }
}

function withKey<T>(run: () => T): T {
  return withEnv(KEY, run);
}

/**
 * Run with `DATA_ENCRYPTION_KEY` set to exactly this, or unset.
 *
 * Hermetic on purpose. These tests originally read whatever the environment
 * happened to hold, so "no key configured" quietly meant "no key on this
 * machine" — and they failed the moment the suite was run with a key set,
 * which is how it will be run on any deployment that takes the preflight
 * seriously. A test whose result depends on the shell it was started from is
 * not testing what it says it is.
 */
function withEnv<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.DATA_ENCRYPTION_KEY;
  if (value === undefined) delete process.env.DATA_ENCRYPTION_KEY;
  else process.env.DATA_ENCRYPTION_KEY = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = previous;
  }
}

/** Every string anywhere in a value, however deeply nested. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) strings(item, out);
  }
  return out;
}

const deal = (): DealRecord => {
  const first = SEED_DEALS[0];
  if (first === undefined) throw new Error("no seed deal");
  return first;
};

describe("the cipher", () => {
  it("round-trips", () => {
    const key = readKey(KEY);
    const out = encrypt("My father passed away last year.", key);
    expect(isEncrypted(out)).toBe(true);
    expect(out).not.toContain("father");
    expect(decrypt(out, key)).toBe("My father passed away last year.");
  });

  it("produces a different ciphertext every time for the same input", () => {
    const key = readKey(KEY);
    // A fresh IV per value. Without one, two sellers reporting the same thing
    // would be visibly the same in the database, which is most of what you
    // wanted to hide.
    expect(encrypt("probate", key)).not.toBe(encrypt("probate", key));
  });

  it("refuses a tampered value rather than returning something plausible", () => {
    const key = readKey(KEY);
    const out = encrypt("hasIndependentLegalAdvice:true", key);
    const flipped = `${out.slice(0, -2)}${out.slice(-2) === "AA" ? "BB" : "AA"}`;
    // GCM is authenticated. These values decide whether a vulnerable seller's
    // deal is blocked, so decrypting to something else would be worse than
    // failing.
    expect(() => decrypt(flipped, key)).toThrow();
  });

  it("never double-encrypts", () => {
    const key = readKey(KEY);
    const once = encrypt("probate", key);
    expect(encrypt(once, key)).toBe(once);
  });

  it("refuses a key of the wrong length rather than stretching it", () => {
    expect(() => readKey(Buffer.alloc(16, 1).toString("base64"))).toThrow(MissingKeyError);
    expect(readKey("  ")).toBeUndefined();
    withEnv(undefined, () => {
      expect(readKey(undefined)).toBeUndefined();
    });
  });

  it("says the data is intact when the key is the thing that is missing", () => {
    const out = encrypt("probate", readKey(KEY));
    withEnv(undefined, () => {
      expect(() => decrypt(out, undefined)).toThrow(/key is missing/);
    });
  });

  it("passes plaintext through, so encryption can be switched on later", () => {
    expect(decrypt("probate", readKey(KEY))).toBe("probate");
    withEnv(undefined, () => {
      expect(encrypt("probate", undefined)).toBe("probate");
    });
  });
});

describe("sealing a deal", () => {
  it("leaves nothing about the seller in plaintext", () => {
    withKey(() => {
      const sealedDeal = sealDeal(deal());
      const haystack = strings(sealedDeal).join(" ").toLowerCase();

      // Every term a database dump must not hand over.
      for (const term of [
        "probate",
        "father passed away",
        "hasindependentlegaladvice",
        "ageband",
        "under-65",
        "executor",
      ]) {
        expect(haystack.includes(term), `"${term}" survived sealing`).toBe(false);
      }
    });
  });

  it("seals both copies of the seller, not just the obvious one", () => {
    withKey(() => {
      const sealedDeal = sealDeal(deal());
      // `record.seller` is the profile; `record.inputs.seller` is the same
      // person as the engine received them. Sealing one and not the other
      // looks encrypted and puts the plaintext four lines further down the
      // same document. The round-trip test passed perfectly while that was
      // true, which is why this one exists.
      expect(isEncrypted(sealedDeal.seller.narrative ?? "")).toBe(true);
      expect(isEncrypted(sealedDeal.inputs.seller.narrative ?? "")).toBe(true);
      expect(isEncrypted(String(sealedDeal.seller.situation))).toBe(true);
      expect(isEncrypted(String(sealedDeal.inputs.seller.situation))).toBe(true);
    });
  });

  it("restores the record exactly", () => {
    withKey(() => {
      const original = deal();
      expect(openDeal(sealDeal(original))).toEqual(original);
    });
  });

  it("is a no-op with no key, so a laptop still works", () => {
    withEnv(undefined, () => {
      const original = deal();
      expect(sealDeal(original)).toEqual(original);
      expect(openDeal(original)).toEqual(original);
    });
  });

  it("reads a record written before encryption was switched on", () => {
    withKey(() => {
      // Plaintext in, plaintext out. Without this, turning the key on would
      // make every existing row unreadable.
      expect(openDeal(deal())).toEqual(deal());
    });
  });
});

describe("the sealed store", () => {
  it("covers every method on the contract that handles a deal", () => {
    // A fifth deal method added to `Store` and not wrapped here would store
    // plaintext silently. This fails when that happens, which is the only way
    // anybody would find out.
    const wrapped = sealed({} as Store);
    const covered = new Set(Object.keys(wrapped));

    const dealMethods = [
      "listDeals",
      "pageDeals",
      "getDeal",
      "saveDeal",
      "replaceAll",
    ];
    for (const method of dealMethods) {
      expect(covered.has(method), `${method} is not sealed`).toBe(true);
    }
  });

  it("seals on the way in and opens on the way out", async () => {
    await withKeyAsync(async () => {
      let stored: DealRecord | undefined;
      const fake = {
        saveDeal: async (d: DealRecord) => {
          stored = d;
          return d;
        },
        listDeals: async () => (stored === undefined ? [] : [stored]),
      } as unknown as Store;

      const wrapped = sealed(fake);
      await wrapped.saveDeal(deal());

      // What the engine was handed.
      expect(isEncrypted(stored?.seller.narrative ?? "")).toBe(true);
      // What a caller gets back.
      const [out] = await wrapped.listDeals();
      expect(out?.seller.narrative).toBe(deal().seller.narrative);
    });
  });
});

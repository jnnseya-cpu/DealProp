import { describe, expect, it } from "vitest";
import {
  buildPendingCode,
  checkVerificationCode,
  generateVerificationCode,
  hashVerificationCode,
  MAX_VERIFICATION_ATTEMPTS,
} from "@backend/auth/emailVerification";
import { isEmailVerified, type Account } from "@shared/domain/accounts";

const SECRET = "test-operator-secret";

describe("email verification code", () => {
  it("generates a six-digit numeric code", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateVerificationCode()).toMatch(/^\d{6}$/);
    }
  });

  it("stores only a keyed hash, never the code, and the hash needs the secret", () => {
    const pending = buildPendingCode("123456", SECRET);
    expect(pending.codeHash).not.toContain("123456");
    // The HMAC is reproducible with the secret and different without it.
    expect(pending.codeHash).toBe(hashVerificationCode("123456", SECRET));
    expect(hashVerificationCode("123456", "other-secret")).not.toBe(pending.codeHash);
  });

  it("accepts the correct code and rejects a wrong one", () => {
    const pending = buildPendingCode("424242", SECRET);
    expect(checkVerificationCode(pending, "424242", SECRET).ok).toBe(true);
    const wrong = checkVerificationCode(pending, "000000", SECRET);
    expect(wrong.ok).toBe(false);
    expect(wrong.ok === false && wrong.deadCode).toBe(false); // a plain miss, try again
  });

  it("treats an expired code as dead, not merely wrong", () => {
    const past = new Date(Date.now() - 60_000);
    const pending = buildPendingCode("111111", SECRET, new Date(past.getTime() - 60 * 60_000));
    const r = checkVerificationCode(pending, "111111", SECRET);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.deadCode).toBe(true);
  });

  it("treats a spent attempt budget as dead", () => {
    const pending = { ...buildPendingCode("222222", SECRET), attempts: MAX_VERIFICATION_ATTEMPTS };
    const r = checkVerificationCode(pending, "222222", SECRET);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.deadCode).toBe(true);
  });

  it("reports nothing-to-verify for an account with no pending code", () => {
    const r = checkVerificationCode(undefined, "222222", SECRET);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.deadCode).toBe(true);
  });
});

describe("isEmailVerified — three states, two answers", () => {
  const base: Account = {
    id: "acc-1",
    email: "a@b.com",
    name: "A",
    role: "seller",
    passwordHash: "x",
    passwordSalt: "y",
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("is verified when a verification date is recorded", () => {
    expect(isEmailVerified({ ...base, emailVerifiedAt: "2026-01-02T00:00:00.000Z" })).toBe(true);
  });

  it("is NOT verified while a code is pending and no date is set", () => {
    expect(
      isEmailVerified({ ...base, pendingEmailCode: buildPendingCode("333333", SECRET) }),
    ).toBe(false);
  });

  it("grandfathers a legacy account that has neither field", () => {
    expect(isEmailVerified(base)).toBe(true);
  });
});

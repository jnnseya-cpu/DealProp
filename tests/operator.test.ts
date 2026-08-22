import { describe, expect, it } from "vitest";
import {
  assertOperator,
  constantTimeEqual,
  OperatorAccessDenied,
  operatorCookieValue,
  operatorPasswordMatches,
  verifyOperatorCookie,
} from "@backend/auth/operator";
import { createSession, readSession } from "@backend/auth/session";

const SECRET = "correct-horse-battery-staple";

describe("operator cookie", () => {
  it("does not contain the secret", async () => {
    // A cookie that IS the password can be replayed as the password. This one
    // is an HMAC under it, so a stolen cookie unlocks only this session.
    const value = await operatorCookieValue(SECRET);
    expect(value).not.toContain(SECRET);
    expect(value.length).toBeGreaterThan(20);
  });

  it("verifies a cookie it issued", async () => {
    expect(await verifyOperatorCookie(await operatorCookieValue(SECRET), SECRET)).toBe(true);
  });

  it("rejects a cookie issued under a different secret", async () => {
    // Rotating the secret must invalidate every live session with no stored
    // state to clear.
    const stale = await operatorCookieValue("previous-secret");
    expect(await verifyOperatorCookie(stale, SECRET)).toBe(false);
  });

  it("rejects a missing or empty cookie", async () => {
    expect(await verifyOperatorCookie(undefined, SECRET)).toBe(false);
    expect(await verifyOperatorCookie("", SECRET)).toBe(false);
  });

  it("fails closed when no secret is configured", async () => {
    // The whole point: an unconfigured deployment denies rather than admits.
    const value = await operatorCookieValue(SECRET);
    expect(await verifyOperatorCookie(value, undefined)).toBe(false);
    expect(await verifyOperatorCookie(value, "")).toBe(false);
  });

  it("is stable for the same secret", async () => {
    expect(await operatorCookieValue(SECRET)).toBe(await operatorCookieValue(SECRET));
  });
});

describe("operator password", () => {
  it("accepts the configured secret", async () => {
    expect(await operatorPasswordMatches(SECRET, SECRET)).toBe(true);
  });

  it("rejects anything else, including a prefix of it", async () => {
    expect(await operatorPasswordMatches("wrong", SECRET)).toBe(false);
    expect(await operatorPasswordMatches(SECRET.slice(0, -1), SECRET)).toBe(false);
    expect(await operatorPasswordMatches("", SECRET)).toBe(false);
  });

  it("rejects every submission when no secret is configured", async () => {
    expect(await operatorPasswordMatches("", undefined)).toBe(false);
    expect(await operatorPasswordMatches("anything", "")).toBe(false);
  });
});

describe("constant-time comparison", () => {
  it("compares equal and unequal strings correctly", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });
});

describe("defence in depth", () => {
  it("denies when the cookie is absent, whatever middleware did", async () => {
    // CVE-2025-29927 let a crafted x-middleware-subrequest header skip Next
    // middleware entirely. The framework is patched, but these pages carry
    // special-category personal data and must not depend on one lock.
    const previous = process.env.OPERATOR_SECRET;
    process.env.OPERATOR_SECRET = SECRET;
    try {
      await expect(assertOperator(undefined)).rejects.toBeInstanceOf(OperatorAccessDenied);
      await expect(assertOperator("forged")).rejects.toBeInstanceOf(OperatorAccessDenied);
      await expect(assertOperator(await operatorCookieValue(SECRET))).resolves.toBeUndefined();
    } finally {
      process.env.OPERATOR_SECRET = previous;
    }
  });

  it("denies every request when no secret is configured", async () => {
    const previous = process.env.OPERATOR_SECRET;
    delete process.env.OPERATOR_SECRET;
    try {
      await expect(assertOperator(await operatorCookieValue(SECRET))).rejects.toBeInstanceOf(
        OperatorAccessDenied,
      );
    } finally {
      if (previous !== undefined) process.env.OPERATOR_SECRET = previous;
    }
  });
});

describe("per-account sessions", () => {
  it("issues a session that verifies and does not contain the secret", async () => {
    const cookie = await createSession("acc-1", SECRET);
    expect(cookie).not.toContain(SECRET);
    const claims = await readSession(cookie, SECRET);
    expect(claims?.accountId).toBe("acc-1");
  });

  it("rejects a forged or tampered cookie", async () => {
    const cookie = await createSession("acc-1", SECRET);
    // Swapping the account id is the obvious attack: become somebody else
    // without knowing their password.
    const tampered = cookie.replace("acc-1", "acc-2");
    expect(await readSession(tampered, SECRET)).toBeUndefined();
    expect(await readSession("garbage", SECRET)).toBeUndefined();
    expect(await readSession("a.b.c", SECRET)).toBeUndefined();
  });

  it("rejects a session signed with a different secret", async () => {
    expect(await readSession(await createSession("acc-1", "other"), SECRET)).toBeUndefined();
  });

  it("expires after eight hours", async () => {
    const issued = new Date("2026-08-22T00:00:00.000Z");
    const cookie = await createSession("acc-1", SECRET, issued);
    expect(await readSession(cookie, SECRET, new Date("2026-08-22T07:59:00.000Z"))).toBeDefined();
    expect(await readSession(cookie, SECRET, new Date("2026-08-22T08:01:00.000Z"))).toBeUndefined();
  });

  it("rejects a cookie claiming to be issued in the future", async () => {
    const cookie = await createSession("acc-1", SECRET, new Date("2026-08-22T10:00:00.000Z"));
    expect(await readSession(cookie, SECRET, new Date("2026-08-22T09:00:00.000Z"))).toBeUndefined();
  });

  it("fails closed with no secret configured", async () => {
    expect(await readSession(await createSession("acc-1", SECRET), undefined)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import {
  buildPendingReset,
  checkResetToken,
  generateResetToken,
  hashResetToken,
} from "@backend/auth/passwordReset";

const SECRET = "test-operator-secret";

describe("password reset token", () => {
  it("generates a long, URL-safe, unique token", () => {
    const a = generateResetToken();
    const b = generateResetToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThan(40); // 32 bytes base64url
    expect(a).not.toBe(b);
  });

  it("stores only a keyed hash that needs the secret", () => {
    const token = generateResetToken();
    const pending = buildPendingReset(token, SECRET);
    expect(pending.tokenHash).not.toContain(token);
    expect(pending.tokenHash).toBe(hashResetToken(token, SECRET));
    expect(hashResetToken(token, "other-secret")).not.toBe(pending.tokenHash);
  });

  it("accepts the right token and rejects a wrong one", () => {
    const token = generateResetToken();
    const pending = buildPendingReset(token, SECRET);
    expect(checkResetToken(pending, token, SECRET).ok).toBe(true);
    expect(checkResetToken(pending, generateResetToken(), SECRET).ok).toBe(false);
  });

  it("rejects an expired token and an absent one", () => {
    const token = generateResetToken();
    const expired = buildPendingReset(token, SECRET, new Date(Date.now() - 2 * 60 * 60_000));
    expect(checkResetToken(expired, token, SECRET).ok).toBe(false);
    expect(checkResetToken(undefined, token, SECRET).ok).toBe(false);
    expect(checkResetToken(buildPendingReset(token, SECRET), "", SECRET).ok).toBe(false);
  });
});

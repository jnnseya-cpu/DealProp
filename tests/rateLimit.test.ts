import { beforeEach, describe, expect, it } from "vitest";
import { callerFrom, consume, LIMITS, resetLimits } from "@backend/rateLimit";

/**
 * Refusing to do unbounded work for one caller.
 *
 * Nothing on this platform limited an inbound request. Sign-in verifies a
 * password with a memory-hard hash costing ~170ms of CPU on a single-threaded
 * runtime, so six attempts a second saturate a core and every other request on
 * the instance waits behind them. That is not an attack, it is a slow
 * afternoon.
 */

beforeEach(resetLimits);

describe("counting", () => {
  it("allows exactly the stated number, then refuses", () => {
    const limit = LIMITS["sign-in"].requests;
    for (let i = 0; i < limit; i += 1) {
      expect(consume("sign-in", "1.2.3.4", 1_000).allowed, `attempt ${i + 1}`).toBe(true);
    }
    const refused = consume("sign-in", "1.2.3.4", 1_000);
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps callers apart, so one does not spend another's allowance", () => {
    for (let i = 0; i < LIMITS["sign-in"].requests; i += 1) consume("sign-in", "attacker", 1_000);
    expect(consume("sign-in", "attacker", 1_000).allowed).toBe(false);
    expect(consume("sign-in", "somebody-else", 1_000).allowed).toBe(true);
  });

  it("keeps limits apart, so a flood of one does not close another", () => {
    for (let i = 0; i < LIMITS["sign-in"].requests + 5; i += 1) consume("sign-in", "x", 1_000);
    expect(consume("webhook", "x", 1_000).allowed).toBe(true);
  });

  it("reopens once the window passes", () => {
    for (let i = 0; i < LIMITS["sign-in"].requests; i += 1) consume("sign-in", "x", 1_000);
    expect(consume("sign-in", "x", 1_000).allowed).toBe(false);
    expect(consume("sign-in", "x", 1_000 + LIMITS["sign-in"].windowMs + 1).allowed).toBe(true);
  });

  it("tells the caller how long to wait, and never zero while refusing", () => {
    for (let i = 0; i < LIMITS["sign-in"].requests; i += 1) consume("sign-in", "x", 1_000);
    const late = consume("sign-in", "x", 1_000 + LIMITS["sign-in"].windowMs - 10);
    expect(late.allowed).toBe(false);
    expect(late.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});

describe("failing open", () => {
  it("allows when it cannot decide, because a broken limiter must not be an outage", () => {
    // A limiter that throws takes down the thing it protects. Losing the
    // defence is bad; losing the platform is worse.
    expect(consume("sign-in", "", 1_000).allowed).toBe(true);
    expect(consume("sign-in", "x", Number.NaN).allowed).toBe(true);
  });
});

describe("identifying the caller", () => {
  it("reads the first entry of x-forwarded-for, not the last", () => {
    // The first is the client; the rest are proxies. Reading the last limits
    // our own proxy, which means one bad actor exhausts everybody's allowance.
    expect(callerFrom(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1, 10.0.0.2" }))).toBe(
      "9.9.9.9",
    );
  });

  it("falls back to x-real-ip and then to one shared bucket", () => {
    expect(callerFrom(new Headers({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
    // Not "allow unlimited": several unidentified callers sharing a bucket is
    // a worse experience for them and a better one than having no bound.
    expect(callerFrom(new Headers())).toBe("unknown");
  });

  it("is not fooled by an empty forwarded header", () => {
    expect(callerFrom(new Headers({ "x-forwarded-for": "   ", "x-real-ip": "8.8.8.8" }))).toBe(
      "8.8.8.8",
    );
  });
});

describe("the limits themselves", () => {
  it("keeps sign-in the tightest, because it is the one that burns CPU", () => {
    for (const [name, limit] of Object.entries(LIMITS)) {
      expect(limit.requests, name).toBeGreaterThan(0);
      expect(limit.windowMs, name).toBeGreaterThan(0);
    }
    expect(LIMITS["sign-in"].requests).toBeLessThan(LIMITS.webhook.requests);
    expect(LIMITS["sign-in"].requests).toBeLessThan(LIMITS.default.requests);
  });
});

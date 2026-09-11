import { describe, expect, it } from "vitest";
import { seedSafety } from "@backend/store/seed";

/**
 * The guard on the one command that can destroy everything.
 *
 * `seed()` truncates every table — deals, accounts, the ledger, payouts and
 * the append-only audit trail — and replaces them with fixtures. It had no
 * guard of any kind, so `npm run seed` in a shell that happened to have the
 * production `DATABASE_URL` exported was total and unrecoverable data loss
 * from a command whose name suggests it adds something.
 *
 * The whitelist direction is the point of these tests: an unrecognised host
 * must refuse. A blacklist gets the answer wrong on the host nobody thought
 * of, and gets it wrong in the direction that loses the data.
 */
describe("seedSafety", () => {
  it("allows the file store, which is a development convenience by definition", () => {
    expect(seedSafety(undefined, false)).toEqual({
      safe: true,
      target: "the local JSON file store",
    });
    expect(seedSafety("", false).safe).toBe(true);
    expect(seedSafety("   ", false).safe).toBe(true);
  });

  it("allows a database that is demonstrably local", () => {
    for (const host of ["localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal"]) {
      const safety = seedSafety(`postgres://lode:lode@${host}:5432/lode`, false);
      expect(safety.safe, host).toBe(true);
    }
    expect(seedSafety("postgres://lode:lode@[::1]:5432/lode", false).safe).toBe(true);
  });

  it("refuses anything else", () => {
    for (const url of [
      "postgres://u:p@db.production.example.com:5432/lode",
      "postgres://u:p@ep-cool-name-123.eu-west-2.aws.neon.tech/lode",
      "postgresql://u:p@10.0.0.4:5432/lode",
      "postgres://u:p@localhost.evil.example.com:5432/lode",
    ]) {
      const safety = seedSafety(url, false);
      expect(safety.safe, url).toBe(false);
      if (!safety.safe) {
        // The refusal has to say what would have been destroyed. "Refused" on
        // its own gets overridden by whoever is in a hurry.
        expect(safety.reason).toContain("audit trail");
      }
    }
  });

  it("refuses a URL it cannot parse rather than assuming it is local", () => {
    const safety = seedSafety("not a url at all", false);
    expect(safety.safe).toBe(false);
    if (!safety.safe) expect(safety.reason).toContain("could not be parsed");
  });

  it("allows an explicit override, and records that it was one", () => {
    const safety = seedSafety("postgres://u:p@staging.example.com:5432/lode", true);
    expect(safety.safe).toBe(true);
    if (safety.safe) expect(safety.target).toContain("overridden explicitly");
  });

  it("does not let the override turn an unparseable URL into a safe one", () => {
    // Overriding a decision is different from overriding the ability to make
    // one. If we cannot tell what the target is, "I am sure" means nothing.
    expect(seedSafety("::::", true).safe).toBe(false);
  });
});

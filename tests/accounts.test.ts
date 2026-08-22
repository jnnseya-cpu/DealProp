import { describe, expect, it } from "vitest";
import {
  can,
  certificationStatus,
  mayReceiveDealMaterial,
  publicAccount,
  ROLE_LABELS,
  type Account,
} from "@/domain/accounts";
import {
  categoryDefinition,
  UK_INVESTOR_CATEGORISATION,
} from "@/domain/jurisdictions/uk-financial-promotion";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";

const NOW = new Date("2026-08-22T00:00:00.000Z");

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    email: "someone@example.com",
    name: "A Person",
    role: "investor",
    passwordHash: "hash",
    passwordSalt: "salt",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const CERTIFIED = {
  category: "high-net-worth" as const,
  criteriaMet: ["income"],
  certifiedAt: "2026-06-01T00:00:00.000Z",
  statementText: "I had, during the last financial year, an annual income of £170,000 or more.",
  rulesAsOf: UK_INVESTOR_CATEGORISATION.asOf,
};

describe("roles", () => {
  it("never lets an investor or funder near seller data", () => {
    // A funder needs the deal, not the seller's reported health concerns. Least
    // privilege that does the job.
    for (const role of ["investor", "funder"] as const) {
      expect(can(account({ role }), "view-seller-data", NOW).allowed).toBe(false);
    }
  });

  it("lets operators see seller data because the job requires it", () => {
    expect(can(account({ role: "operator" }), "view-seller-data", NOW).allowed).toBe(true);
  });

  it("reserves account management to administrators", () => {
    expect(can(account({ role: "admin" }), "manage-accounts", NOW).allowed).toBe(true);
    expect(can(account({ role: "operator" }), "manage-accounts", NOW).allowed).toBe(false);
  });

  it("always gives a reason, allowed or not", () => {
    // The same standard the Deal Score and match report are held to.
    expect(can(account({ role: "admin" }), "view-deal-material", NOW).reason).not.toBe("");
    expect(can(account({ role: "investor" }), "manage-accounts", NOW).reason).toContain("investor");
  });

  it("refuses everything to a disabled account", () => {
    const disabled = account({ role: "admin", disabledAt: "2026-08-01T00:00:00.000Z" });
    expect(can(disabled, "view-deal-material", NOW).allowed).toBe(false);
    expect(can(disabled, "manage-accounts", NOW).reason).toContain("disabled");
  });

  it("labels every role", () => {
    expect(Object.keys(ROLE_LABELS)).toHaveLength(4);
  });
});

describe("deal material and investor categorisation", () => {
  it("refuses an uncertified investor", () => {
    // This is the whole reason the gate exists: a deal pack to a private
    // investor is a financial promotion under FSMA s.21.
    const decision = mayReceiveDealMaterial(account(), NOW);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("No investor certification");
  });

  it("admits a currently certified investor, and says under what", () => {
    const decision = mayReceiveDealMaterial(account({ certification: CERTIFIED }), NOW);
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toContain("high net worth");
    expect(decision.reason).toContain("FPO art. 48");
  });

  it("treats a lapsed certification as no certification", () => {
    // An expired statement is not a weaker statement. Sending on the strength
    // of one is an unlawful promotion just as surely as sending to somebody
    // who never certified.
    const stale = { ...CERTIFIED, certifiedAt: "2025-01-01T00:00:00.000Z" };
    const decision = mayReceiveDealMaterial(account({ certification: stale }), NOW);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("lapsed");
  });

  it("expires exactly at twelve months, not a day earlier", () => {
    const validFor = UK_INVESTOR_CATEGORISATION.certificationValidMonths;
    expect(validFor).toBe(12);
    const justInside = certificationStatus(
      { certification: { ...CERTIFIED, certifiedAt: "2025-09-01T00:00:00.000Z" } },
      new Date("2026-08-22T00:00:00.000Z"),
    );
    expect(justInside.current).toBe(true);
    const justOutside = certificationStatus(
      { certification: { ...CERTIFIED, certifiedAt: "2025-08-01T00:00:00.000Z" } },
      new Date("2026-08-22T00:00:00.000Z"),
    );
    expect(justOutside.current).toBe(false);
  });

  it("refuses a restricted investor, whose exemption does not cover this", () => {
    // A restricted investor may receive certain restricted mass market
    // investments. An unregulated property deal pack is not one.
    const restricted = { ...CERTIFIED, category: "restricted" as const };
    const decision = mayReceiveDealMaterial(account({ certification: restricted }), NOW);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("may not be sent");
  });

  it("does not require certification from staff", () => {
    // A promotion made to one's own colleagues is not a promotion to an
    // investor.
    expect(mayReceiveDealMaterial(account({ role: "operator" }), NOW).allowed).toBe(true);
    expect(mayReceiveDealMaterial(account({ role: "admin" }), NOW).allowed).toBe(true);
  });

  it("reports an expiry date so it can be chased before it lapses", () => {
    expect(certificationStatus({ certification: CERTIFIED }, NOW).expiresAt).toBe("2027-06-01");
  });
});

describe("the categorisation rules", () => {
  it("marks the thresholds as needing verification", () => {
    // They were raised and the change was then announced for reversal. Nobody
    // should disapply s.21 on the strength of a figure in a repository.
    expect(UK_INVESTOR_CATEGORISATION.requiresVerification).toBe(true);
    expect(UK_INVESTOR_CATEGORISATION.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(UK_INVESTOR_CATEGORISATION.sources.length).toBeGreaterThan(0);
  });

  it("pins the thresholds so a change is a deliberate edit against a failing test", () => {
    expect(UK_INVESTOR_CATEGORISATION.highNetWorthIncome).toBe(17_000_000);
    expect(UK_INVESTOR_CATEGORISATION.highNetWorthNetAssets).toBe(43_000_000);
  });

  it("gives every category a citation and at least one statement", () => {
    for (const c of UK_INVESTOR_CATEGORISATION.categories) {
      expect(c.citation, c.category).toBeTruthy();
      expect(c.criteria.length, c.category).toBeGreaterThan(0);
      for (const criterion of c.criteria) {
        // First person, because the investor signs it as their own statement.
        // A declaration written about someone is not a declaration by them.
        expect(criterion.text, criterion.key).toMatch(/\bI\b/);
      }
    }
  });

  it("marks the category this platform cannot itself certify", () => {
    // A certified sophisticated investor's certificate is signed by an
    // authorised firm. Presenting a form that looks as though we can issue one
    // would be the mistake.
    expect(categoryDefinition("certified-sophisticated")?.requiresThirdPartyCertification).toBe(
      true,
    );
    expect(categoryDefinition("high-net-worth")?.requiresThirdPartyCertification).toBe(false);
  });
});

describe("public account", () => {
  it("never carries the credential across a boundary", () => {
    const shown = publicAccount(account({ passwordHash: "secret-hash", passwordSalt: "s" }));
    expect(JSON.stringify(shown)).not.toContain("secret-hash");
    expect("passwordHash" in shown).toBe(false);
  });

  it("reports disabled as a flag rather than a timestamp", () => {
    expect(publicAccount(account({ disabledAt: "2026-01-01T00:00:00.000Z" })).disabled).toBe(true);
    expect(publicAccount(account()).disabled).toBe(false);
  });
});

describe("passwords", () => {
  it("round-trips a password without storing it", async () => {
    const { hash, salt } = await hashPassword("a-long-enough-password");
    expect(hash).not.toContain("a-long-enough-password");
    expect(await verifyPassword("a-long-enough-password", hash, salt)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const { hash, salt } = await hashPassword("a-long-enough-password");
    expect(await verifyPassword("a-long-enough-passwore", hash, salt)).toBe(false);
  });

  it("salts, so two identical passwords do not share a hash", async () => {
    const a = await hashPassword("the-same-password");
    const b = await hashPassword("the-same-password");
    expect(a.hash).not.toBe(b.hash);
  });

  it("returns false rather than throwing on a corrupt stored hash", async () => {
    // A corrupt record must not be distinguishable from a wrong password by
    // anyone probing from outside.
    expect(await verifyPassword("x-long-enough-here", "not-hex!!", "salt")).toBe(false);
    expect(await verifyPassword("x-long-enough-here", "", "")).toBe(false);
  });

  it("requires length rather than composition", async () => {
    // Composition rules push people towards Password1! and are no longer
    // recommended by NCSC or NIST.
    expect(passwordProblem("short")).toBeDefined();
    expect(passwordProblem("all lower case but long enough")).toBeUndefined();
    expect(passwordProblem("x".repeat(600))?.reason).toContain("too long");
  });
});

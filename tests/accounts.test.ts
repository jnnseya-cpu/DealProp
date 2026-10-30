import { describe, expect, it } from "vitest";
import {
  ALL_ROLES,
  accountRoles,
  can,
  canManageImport,
  canManageMandate,
  canManageProperty,
  certificationStatus,
  isConnectedParty,
  managesAllImports,
  managesAllMandates,
  mayReceiveDealMaterial,
  publicAccount,
  ROLE_LABELS,
  SELF_SERVICE_ROLES,
  RESERVED_ROLES,
  isReservedRole,
  adminAllocatableRoles,
  type Account,
} from "@shared/domain/accounts";
import {
  categoryDefinition,
  UK_INVESTOR_CATEGORISATION,
} from "@shared/domain/jurisdictions/uk-financial-promotion";
import { hashPassword, passwordProblem, verifyPassword } from "@backend/auth/password";

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

  it("labels every role, and no role that does not exist", () => {
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...ALL_ROLES].sort());
  });

  it("gives a seller the least privilege: their own property and nothing else", () => {
    const seller = account({ role: "seller" });
    expect(can(seller, "manage-own-property", NOW).allowed).toBe(true);
    // Never seller data (another person's enquiry), a mandate, deal material or
    // account management.
    for (const perm of [
      "view-seller-data",
      "view-deal-material",
      "manage-mandates",
      "manage-own-mandates",
      "import-own-listings",
      "manage-accounts",
    ] as const) {
      expect(can(seller, perm, NOW).allowed, perm).toBe(false);
    }
  });

  it("self-service is only seller and buyer; staff needs an admin", () => {
    // A form can widen who signs up, never what they are.
    expect([...SELF_SERVICE_ROLES].sort()).toEqual(["investor", "seller"]);
    for (const banned of ["admin", "operator", "funder", "partner"] as const) {
      expect(SELF_SERVICE_ROLES).not.toContain(banned);
    }
    for (const role of SELF_SERVICE_ROLES) expect(ALL_ROLES).toContain(role);
  });

  it("reserves estate agent and lender — nobody allocates them, not even an admin", () => {
    // A regulated real-world status Lode cannot confer, so it is neither
    // self-service nor admin-allocatable.
    expect([...RESERVED_ROLES].sort()).toEqual(["funder", "partner"]);
    expect(isReservedRole("partner")).toBe(true);
    expect(isReservedRole("funder")).toBe(true);
    expect(isReservedRole("seller")).toBe(false);
    // The admin may allocate everything else, and never a reserved role.
    const allocatable = adminAllocatableRoles();
    expect(allocatable).not.toContain("partner");
    expect(allocatable).not.toContain("funder");
    expect(allocatable).toContain("seller");
    expect(allocatable).toContain("investor");
    expect(allocatable).toContain("admin");
    expect(allocatable).toContain("operator");
    // A reserved role is never self-service either.
    for (const r of RESERVED_ROLES) expect(SELF_SERVICE_ROLES).not.toContain(r);
  });
});

describe("multi-role accounts", () => {
  it("unions the roles, primary first, de-duplicated", () => {
    expect(accountRoles(account({ role: "investor" }))).toEqual(["investor"]);
    expect(accountRoles(account({ role: "investor", roles: ["seller"] }))).toEqual([
      "investor",
      "seller",
    ]);
    // A roles array that repeats the primary does not list it twice.
    expect(accountRoles(account({ role: "investor", roles: ["investor", "seller"] }))).toEqual([
      "investor",
      "seller",
    ]);
  });

  it("grants a flipper everything either role allows", () => {
    // A flipper is a buyer (investor) and a seller: it may run its own mandates
    // AND submit/track its own property. Neither role alone can do both.
    const flipper = account({ role: "investor", roles: ["seller"] });
    expect(can(flipper, "manage-own-mandates", NOW).allowed).toBe(true);
    expect(can(flipper, "manage-own-property", NOW).allowed).toBe(true);
    // Still never seller data or account management.
    expect(can(flipper, "view-seller-data", NOW).allowed).toBe(false);
    expect(can(flipper, "manage-accounts", NOW).allowed).toBe(false);
  });

  it("skips the certification gate when a role is also staff", () => {
    // An investor who is also an operator is staff: a promotion to one's own
    // colleagues is not a promotion to an investor, so no certification needed.
    const staffInvestor = account({ role: "investor", roles: ["operator"] });
    expect(can(staffInvestor, "view-deal-material", NOW).allowed).toBe(true);
    // A plain investor without certification still cannot.
    expect(can(account({ role: "investor" }), "view-deal-material", NOW).allowed).toBe(false);
  });
});

describe("connected party", () => {
  it("is false by default and true only when flagged", () => {
    expect(isConnectedParty(account())).toBe(false);
    expect(isConnectedParty(account({ connectedParty: true }))).toBe(true);
  });
});

describe("property ownership", () => {
  it("lets a seller see only the property they submitted", () => {
    const seller = account({ id: "acc-seller", role: "seller" });
    expect(canManageProperty(seller, "acc-seller", NOW).allowed).toBe(true);
    expect(canManageProperty(seller, "acc-other", NOW).allowed).toBe(false);
    // An ownerless deal (operator-entered) is never a seller's to claim.
    expect(canManageProperty(seller, undefined, NOW).allowed).toBe(false);
  });

  it("lets an operator work any property submission", () => {
    const operator = account({ role: "operator" });
    expect(canManageProperty(operator, "acc-anyone", NOW).allowed).toBe(true);
    expect(canManageProperty(operator, undefined, NOW).allowed).toBe(true);
  });

  it("refuses a role that cannot manage property at all", () => {
    expect(canManageProperty(account({ role: "investor" }), "acc-1", NOW).allowed).toBe(false);
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

describe("mandate management", () => {
  it("grants investors and funders the own-scope permission, not the any-scope one", () => {
    for (const role of ["investor", "funder"] as const) {
      expect(can(account({ role }), "manage-own-mandates", NOW).allowed).toBe(true);
      // The any-scope permission also gates discovery and outreach, which draft
      // letters to owners. A customer must never hold it.
      expect(can(account({ role }), "manage-mandates", NOW).allowed).toBe(false);
    }
  });

  it("lets operators and admins manage any mandate", () => {
    for (const role of ["operator", "admin"] as const) {
      expect(can(account({ role }), "manage-mandates", NOW).allowed).toBe(true);
    }
  });

  it("lets a customer manage a mandate they own and refuses one they do not", () => {
    const investor = account({ id: "acc-buyer", role: "investor" });
    expect(canManageMandate(investor, "acc-buyer", NOW).allowed).toBe(true);
    const other = canManageMandate(investor, "acc-someone-else", NOW);
    expect(other.allowed).toBe(false);
    expect(other.reason).toContain("another account");
  });

  it("refuses a customer an ownerless mandate rather than letting them claim it", () => {
    // Operator-created mandates have no owner. A self-service account must not
    // be able to adopt one by posting its id, which undefined === id prevents.
    const investor = account({ id: "acc-buyer", role: "investor" });
    expect(canManageMandate(investor, undefined, NOW).allowed).toBe(false);
  });

  it("lets an operator manage any mandate, owned or not", () => {
    const operator = account({ id: "acc-op", role: "operator" });
    expect(canManageMandate(operator, "acc-someone", NOW).allowed).toBe(true);
    expect(canManageMandate(operator, undefined, NOW).allowed).toBe(true);
  });

  it("refuses a disabled account whatever it would otherwise hold", () => {
    const disabled = account({ id: "acc-buyer", role: "investor", disabledAt: "2026-08-01T00:00:00.000Z" });
    expect(canManageMandate(disabled, "acc-buyer", NOW).allowed).toBe(false);
  });

  it("separates who may see all mandates from who may see their own", () => {
    expect(managesAllMandates(account({ role: "operator" }), NOW)).toBe(true);
    expect(managesAllMandates(account({ role: "admin" }), NOW)).toBe(true);
    expect(managesAllMandates(account({ role: "investor" }), NOW)).toBe(false);
    expect(managesAllMandates(account({ role: "funder" }), NOW)).toBe(false);
  });

  it("gives a partner the import permission and nothing else", () => {
    const partner = account({ role: "partner" });
    expect(can(partner, "import-own-listings", NOW).allowed).toBe(true);
    // The least privilege that does the job: no seller data, no mandates, no
    // deal material.
    for (const p of ["view-seller-data", "manage-mandates", "manage-own-mandates", "view-deal-material"] as const) {
      expect(can(partner, p, NOW).allowed, p).toBe(false);
    }
  });

  it("lets a partner manage their own listing and refuses another firm's", () => {
    const partner = account({ id: "acc-agent", role: "partner" });
    expect(canManageImport(partner, "acc-agent", NOW).allowed).toBe(true);
    const other = canManageImport(partner, "acc-other-agent", NOW);
    expect(other.allowed).toBe(false);
    expect(other.reason).toContain("another account");
    // An operator import has no owner; a partner must not adopt it by id.
    expect(canManageImport(partner, undefined, NOW).allowed).toBe(false);
  });

  it("lets an operator manage any imported listing, owned or not", () => {
    const operator = account({ id: "acc-op", role: "operator" });
    expect(canManageImport(operator, "acc-agent", NOW).allowed).toBe(true);
    expect(canManageImport(operator, undefined, NOW).allowed).toBe(true);
  });

  it("refuses a disabled partner their own listing", () => {
    const disabled = account({ id: "acc-agent", role: "partner", disabledAt: "2026-08-01T00:00:00.000Z" });
    expect(canManageImport(disabled, "acc-agent", NOW).allowed).toBe(false);
  });

  it("separates who sees all imports from who sees their own", () => {
    expect(managesAllImports(account({ role: "operator" }), NOW)).toBe(true);
    expect(managesAllImports(account({ role: "admin" }), NOW)).toBe(true);
    expect(managesAllImports(account({ role: "partner" }), NOW)).toBe(false);
  });
});

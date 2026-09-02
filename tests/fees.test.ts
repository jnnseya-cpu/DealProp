import { describe, expect, it } from "vitest";
import { bps, fromMajor, pct, toMajor, ZERO } from "@shared/money";
import { appraise } from "@shared/domain/economics";
import type { DealInputs, FinanceTerms, PropertyFacts, SellerProfile } from "@shared/domain/types";
import {
  chargeableFees,
  feeAmount,
  feePosition,
  FEE_DEFINITIONS,
  type FeeContext,
  type FeeKey,
} from "@shared/domain/fees";
import { DEFAULT_ASSUMPTIONS, STREAMS, dealRevenue } from "@shared/domain/revenue";
import { readPermissions, heldKeys, PERMISSIONS } from "@shared/domain/permissions";

/**
 * The fee engine.
 *
 * The revenue model says what a completed deal is worth. This says what may
 * actually be invoiced, and the tests worth having are the ones proving it
 * refuses: without the permission, before the stage, and — the one that
 * actually decides whether the money is collectable — without the disclosure.
 */

const finance: FinanceTerms = {
  ltvBps: pct(70),
  refurbAdvanceBps: pct(100),
  annualRateBps: pct(12),
  arrangementFeeBps: pct(2),
  exitFeeBps: pct(1),
  interestRolledUp: true,
  lenderCosts: fromMajor(1_500),
};
const property: PropertyFacts = {
  id: "t",
  jurisdiction: "GB-ENG",
  postcodeArea: "B23",
  locality: "Erdington",
  propertyType: "house",
  tenure: "freehold",
  bedrooms: 3,
  occupancy: "vacant",
  openMarketValue: fromMajor(212_000),
  valuationConfidence: bps(8_500),
  refurbishmentEstimate: fromMajor(34_000),
  postWorksValue: fromMajor(285_000),
  monthlyRent: fromMajor(1_250),
  knownIssues: [],
};
const seller: SellerProfile = { situation: "probate", priorities: ["speed"], screening: {} };
const inputs: DealInputs = {
  property,
  seller,
  purchasePrice: fromMajor(172_000),
  buyerOwnsOtherProperty: true,
  buyerIsCompany: true,
  buyerIsNonResident: false,
  holdMonths: 9,
  structure: "bridging-refurb-refinance",
  finance,
  exit: "sell",
};
const APPRAISAL = appraise(inputs);

const DISCLOSED = {
  at: "2026-08-01T00:00:00.000Z",
  by: "Jo Bloggs",
  wording: "Our fee is 0.75% of the purchase price, payable by the buyer on completion.",
};

const EVERYTHING = heldKeys(
  readPermissions(
    "estate-agency-aml:XAML00000000,redress-scheme:TPO-12345,credit-broking:123456",
  ),
);

function context(overrides: Partial<FeeContext> = {}): FeeContext {
  return {
    appraisal: APPRAISAL,
    status: "completed",
    permissionsHeld: EVERYTHING,
    disclosure: DISCLOSED,
    raised: [],
    ...overrides,
  };
}

function fee(key: FeeKey, ctx: FeeContext) {
  const found = chargeableFees(ctx).find((f) => f.definition.key === key);
  if (found === undefined) throw new Error(`no fee ${key}`);
  return found;
}

describe("the catalogue", () => {
  it("never invoices the seller", () => {
    // The seller is the supply engine and is not charged. There is no code
    // path that bills them and there must never be one.
    for (const definition of FEE_DEFINITIONS) {
      expect(definition.payer, definition.key).not.toBe("seller");
      expect(["buyer", "lender"]).toContain(definition.payer);
    }
  });

  it("names permissions that exist in the catalogue", () => {
    const known = new Set(PERMISSIONS.map((p) => p.key));
    for (const definition of FEE_DEFINITIONS) {
      expect(definition.requiresPermissions.length).toBeGreaterThan(0);
      for (const key of definition.requiresPermissions) expect(known.has(key)).toBe(true);
    }
  });

  it("charges the same amount the revenue model states", () => {
    // Two places that state an amount eventually disagree, and the customer
    // never loses that argument. The fee engine is the one that decides.
    const revenue = dealRevenue(APPRAISAL, { ...DEFAULT_ASSUMPTIONS, permissionsHeld: EVERYTHING });
    for (const definition of FEE_DEFINITIONS) {
      const line = revenue.lines.find((l) => l.stream === definition.stream);
      expect(line?.amount, definition.key).toBe(feeAmount(definition.key, APPRAISAL));
    }
  });
});

describe("what stops a fee", () => {
  it("refuses without the permission, and says which regulator grants it", () => {
    const none = fee("deal-success-fee", context({ permissionsHeld: [] }));
    expect(none.chargeable).toBe(false);
    const said = none.blockers.map((b) => `${b.reason} ${b.remedy}`).join(" ");
    expect(said).toContain("Estate agency AML supervision");
    expect(said).toContain("HMRC");
    expect(said).toContain("offence");
  });

  it("refuses on a partial permission, because both are required", () => {
    const partial = heldKeys(readPermissions("estate-agency-aml:XAML00000000"));
    const success = fee("deal-success-fee", context({ permissionsHeld: partial }));
    expect(success.chargeable).toBe(false);
    expect(success.blockers.map((b) => b.reason).join(" ")).toContain("redress");

    // Packaging needs only the AML supervision, so it clears on the same set.
    expect(fee("deal-packaging", context({ permissionsHeld: partial })).chargeable).toBe(true);
  });

  it("refuses before the deal reaches the stage the fee falls due at", () => {
    const early = fee("deal-success-fee", context({ status: "in-market" }));
    expect(early.chargeable).toBe(false);
    expect(early.blockers.map((b) => b.remedy).join(" ")).toContain("work not yet done");

    // Packaging is for the pack, not the completion, so it is due earlier.
    expect(fee("deal-packaging", context({ status: "in-market" })).chargeable).toBe(true);
  });

  it("refuses without the disclosure, and says why that is the collectable part", () => {
    const undisclosed = fee("deal-success-fee", context({ disclosure: undefined }));
    expect(undisclosed.chargeable).toBe(false);
    const said = undisclosed.blockers.map((b) => `${b.reason} ${b.remedy}`).join(" ");
    expect(said).toContain("Estate Agents Act 1979");
    expect(said).toContain("unenforceable");
  });

  it("does not require a seller disclosure for a fee the lender pays", () => {
    // The seller is not a party to it, so there is nothing to disclose to them.
    const intro = fee("funding-introduction", context({ disclosure: undefined }));
    expect(intro.chargeable).toBe(true);
    expect(intro.definition.payer).toBe("lender");
  });

  it("refuses a fee already raised", () => {
    const twice = fee("deal-success-fee", context({ raised: ["deal-success-fee"] }));
    expect(twice.chargeable).toBe(false);
    expect(twice.alreadyRaised).toBe(true);
    expect(twice.blockers.map((b) => b.remedy).join(" ")).toContain("second invoice for the same work");
  });

  it("reports every reason at once rather than the first", () => {
    // A page that fixes one blocker and discovers another is a page somebody
    // gives up on.
    const nothing = fee(
      "deal-success-fee",
      context({ permissionsHeld: [], status: "new", disclosure: undefined }),
    );
    expect(nothing.blockers.length).toBe(4);
  });
});

describe("the position on a deal", () => {
  it("adds up only what may be invoiced now", () => {
    const position = feePosition(context());
    expect(position.fees).toHaveLength(3);
    expect(position.chargeableNow).toBe(
      feeAmount("deal-packaging", APPRAISAL) +
        feeAmount("deal-success-fee", APPRAISAL) +
        feeAmount("funding-introduction", APPRAISAL),
    );
    expect(position.blocked).toBe(ZERO);
    expect(position.summary).toContain("may be invoiced now");
  });

  it("separates blocked from raised", () => {
    const position = feePosition(
      context({ status: "in-market", raised: ["deal-packaging"] }),
    );
    expect(toMajor(position.raised)).toBe(toMajor(feeAmount("deal-packaging", APPRAISAL)));
    expect(position.blocked).toBeGreaterThan(ZERO);
    expect(position.chargeableNow).toBe(ZERO);
  });

  it("says plainly when nothing may be invoiced", () => {
    const position = feePosition(context({ permissionsHeld: [], status: "new", disclosure: undefined }));
    expect(position.chargeableNow).toBe(ZERO);
    expect(position.summary).toContain("waiting on something");
  });
});

describe("the revenue model and the fee engine agree about permissions", () => {
  it("excludes the same streams the fee engine blocks", () => {
    const revenue = dealRevenue(APPRAISAL, { ...DEFAULT_ASSUMPTIONS, permissionsHeld: [] });
    const blockedStreams = new Set(
      chargeableFees(context({ permissionsHeld: [] }))
        .filter((f) => f.blockers.some((b) => b.reason.includes("not recorded as held")))
        .map((f) => f.definition.stream),
    );
    for (const line of revenue.lines) {
      const gated = STREAMS.find((s) => s.key === line.stream)?.requiresPermissions ?? [];
      if (gated.length === 0) continue;
      if (!blockedStreams.has(line.stream)) continue;
      expect(line.included, line.label).toBe(false);
    }
  });
});

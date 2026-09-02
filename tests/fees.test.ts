import { describe, expect, it } from "vitest";
import { bps, fromMajor, pct, toMajor, ZERO } from "@shared/money";
import { appraise } from "@shared/domain/economics";
import type { DealInputs, FinanceTerms, PropertyFacts, SellerProfile } from "@shared/domain/types";
import {
  bindsSellerElsewhere,
  chargeableFees,
  feeAmount,
  feePosition,
  FEE_DEFINITIONS,
  type AgentInstruction,
  type FeeContext,
  type FeeKey,
  type SellerAgreement,
} from "@shared/domain/fees";
import { sellerFeeHeadline, successFee, successFeeBand } from "@shared/domain/pricing";
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

const SIGNED: SellerAgreement = {
  signedAt: "2026-07-20T00:00:00.000Z",
  signedBy: "A. Okafor",
  service: "standard",
  termsVersion: "seller-terms-1",
};

function context(overrides: Partial<FeeContext> = {}): FeeContext {
  return {
    appraisal: APPRAISAL,
    status: "completed",
    permissionsHeld: EVERYTHING,
    disclosure: DISCLOSED,
    raised: [],
    sellerAgreement: SIGNED,
    ...overrides,
  };
}

function fee(key: FeeKey, ctx: FeeContext) {
  const found = chargeableFees(ctx).find((f) => f.definition.key === key);
  if (found === undefined) throw new Error(`no fee ${key}`);
  return found;
}

describe("the catalogue", () => {
  it("charges the seller once, on completion, and at no other stage", () => {
    // The proposition is "pay only when your property sells". One seller-paid
    // fee exists; if a second ever appears, or the first becomes due before
    // completion, the proposition is false and this fails.
    const sellerPaid = FEE_DEFINITIONS.filter((d) => d.payer === "seller");
    expect(sellerPaid).toHaveLength(1);
    expect(sellerPaid[0]?.key).toBe("seller-success-fee");
    expect(sellerPaid[0]?.dueAt).toEqual(["completed"]);
    expect(sellerPaid[0]?.requiresSellerDisclosure).toBe(true);
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
      expect(line?.amount, definition.key).toBe(
        feeAmount(definition.key, { appraisal: APPRAISAL, sellerAgreement: SIGNED }),
      );
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

describe("the seller success fee", () => {
  const instructed = (kind: AgentInstruction["kind"], released = false): AgentInstruction => ({
    kind,
    agent: "Marsh & Co",
    ...(released ? { releasedAt: "2026-07-01T00:00:00.000Z", releasedBy: "Jo Bloggs" } : {}),
  });

  it("is the banded price from the catalogue, not a bare percentage", () => {
    const charged = fee("seller-success-fee", context()).amount;
    expect(charged).toBe(successFee(APPRAISAL.inputs.purchasePrice, "standard"));

    // A £172,000 sale at 0.60% is £1,032, which is below the floor.
    expect(toMajor(charged)).toBe(1_250);

    // The managed service is a different signed service and a different price.
    const managed = fee(
      "seller-success-fee",
      context({ sellerAgreement: { ...SIGNED, service: "managed" } }),
    ).amount;
    expect(toMajor(managed)).toBe(2_500);
  });

  it("refuses without a signed agreement", () => {
    const unsigned = fee("seller-success-fee", context({ sellerAgreement: undefined }));
    expect(unsigned.chargeable).toBe(false);
    expect(unsigned.blockers.map((b) => b.reason).join(" ")).toContain("has not signed");

    // The amount is still quoted, because showing a seller what it would cost
    // is not charging them.
    expect(unsigned.amount).toBeGreaterThan(ZERO);
  });

  it("refuses while the seller is bound to another agent, and says why", () => {
    for (const kind of ["sole-selling-rights", "sole-agency"] as const) {
      const bound = fee("seller-success-fee", context({ existingInstruction: instructed(kind) }));
      expect(bound.chargeable, kind).toBe(false);
      const said = bound.blockers.map((b) => `${b.reason} ${b.remedy}`).join(" ");
      expect(said, kind).toContain("Marsh & Co");
      expect(said, kind).toContain("pay twice");
    }
  });

  it("clears once the instruction is released, and never blocked multi-agency", () => {
    expect(
      fee("seller-success-fee", context({ existingInstruction: instructed("sole-agency", true) }))
        .chargeable,
    ).toBe(true);

    // Under multi-agency the seller has already accepted that whoever
    // introduces the buyer is paid. That is the arrangement we are part of.
    expect(bindsSellerElsewhere(instructed("multi-agency"))).toBe(false);
    expect(
      fee("seller-success-fee", context({ existingInstruction: instructed("multi-agency") }))
        .chargeable,
    ).toBe(true);
  });

  it("is not payable on a sale that did not complete", () => {
    for (const status of ["new", "qualified", "in-market", "funded"] as const) {
      const early = fee("seller-success-fee", context({ status }));
      expect(early.chargeable, status).toBe(false);
    }
  });
});

describe("what the seller is told the fee is", () => {
  it("states the rate, the floor and the cap the engine actually charges", () => {
    // A rate published on one page and charged from another eventually
    // disagree, and the version the seller read is never the one that loses.
    const band = successFeeBand("standard");
    const headline = sellerFeeHeadline();
    expect(headline).toContain("0.60%");
    expect(headline).toContain("£1,250");
    expect(headline).toContain("£7,500");

    // At a price between the floor and the cap the percentage is what is
    // charged, so the sentence describes the arithmetic rather than decorating
    // it.
    const midMarket = fromMajor(500_000);
    expect(successFee(midMarket, "standard")).toBe(
      (midMarket * band.rateBps) / 10_000,
    );
  });

  it("does not offer a cap it has not got", () => {
    // The managed service is negotiated at the top end rather than capped, so
    // the sentence must not imply a ceiling.
    expect(sellerFeeHeadline("managed")).not.toContain("capped");
    expect(successFeeBand("managed").maximum).toBeUndefined();
  });
});

describe("the position on a deal", () => {
  it("adds up only what may be invoiced now", () => {
    const position = feePosition(context());
    expect(position.fees).toHaveLength(FEE_DEFINITIONS.length);
    expect(position.chargeableNow).toBe(
      feeAmount("deal-packaging", { appraisal: APPRAISAL }) +
        feeAmount("deal-success-fee", { appraisal: APPRAISAL }) +
        feeAmount("seller-success-fee", { appraisal: APPRAISAL, sellerAgreement: SIGNED }) +
        feeAmount("funding-introduction", { appraisal: APPRAISAL }),
    );
    expect(position.blocked).toBe(ZERO);
    expect(position.summary).toContain("may be invoiced now");
  });

  it("separates blocked from raised", () => {
    const position = feePosition(
      context({ status: "in-market", raised: ["deal-packaging"] }),
    );
    expect(toMajor(position.raised)).toBe(toMajor(feeAmount("deal-packaging", { appraisal: APPRAISAL })));
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

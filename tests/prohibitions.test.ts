import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bps, fromMajor, pct, ZERO } from "@shared/money";
import {
  checkValuationLanguage,
  funderIsVerified,
  FUNDER_VERIFICATION_MONTHS,
  PERMITTED_RANKING_INPUTS,
  PROHIBITIONS,
  prohibition,
  type FunderVerification,
} from "@shared/domain/prohibitions";
import { EFFECT_OWNERS, type ProposalEffect } from "@shared/domain/agents";
import { FEE_DEFINITIONS } from "@shared/domain/fees";
import { GRADES } from "@shared/domain/passport";
import { categoryDefinition } from "@shared/domain/inventory";
import { quoteReveal } from "@shared/domain/reveal";
import { materialInformation } from "@shared/domain/materialInformation";
import { matchFundingBox, type FundingBox } from "@shared/domain/matching";
import { scoreDeal } from "@shared/domain/dealScore";
import { SEED_FUNDING_BOXES } from "@backend/store/seed";
import type { DealInputs, FinanceTerms, PropertyFacts, SellerProfile } from "@shared/domain/types";
import { heldKeys, readPermissions } from "@shared/domain/permissions";
import { buyerPassport } from "@shared/domain/passport";

/**
 * The twelve things this platform must not do.
 *
 * A prohibition with no control behind it is a sentence in a document. Each
 * one below is exercised against the code that refuses, so that removing the
 * refusal fails a test rather than passing quietly — which is the only
 * difference between a rule and a policy.
 */

const NOW = new Date("2026-09-01T00:00:00.000Z");

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
  id: "p",
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
const seller: SellerProfile = { situation: "downsizing", priorities: ["speed"], screening: {} };
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

const EVERYTHING = heldKeys(
  readPermissions("estate-agency-aml:XAML00000000,redress-scheme:TPO-12345"),
);

const READY = buyerPassport(
  {
    identityVerifiedAt: "2026-08-01T00:00:00.000Z",
    screenedAt: "2026-08-01T00:00:00.000Z",
    sourceOfFundsAt: "2026-08-01T00:00:00.000Z",
    proofOfFunds: {
      kind: "cash",
      evidencedAt: "2026-08-20T00:00:00.000Z",
      amount: fromMajor(250_000),
      issuer: "Lloyds",
    },
    completedPurchases: 1,
  },
  fromMajor(172_000),
  NOW,
);

const MARKETABLE = materialInformation(property, {
  price: { state: "stated", value: "£172,000" },
  tenure: { state: "stated", value: "Freehold" },
  "council-tax": { state: "stated", value: "Band B" },
});

const CONFIRMED = {
  category: "owner-verified" as const,
  confirmation: {
    by: "owner" as const,
    at: "2026-08-01T00:00:00.000Z",
    recordedBy: "Jo Bloggs",
    evidence: "Confirmed by telephone.",
  },
};

describe("the catalogue is complete and points at something", () => {
  it("names all twelve, each with a control behind it", () => {
    expect(PROHIBITIONS).toHaveLength(12);
    for (const rule of PROHIBITIONS) {
      // A rule with no enforcement is a rule that stops nothing, which is the
      // state most of these are in on most platforms.
      expect(rule.enforcedBy.length, rule.key).toBeGreaterThan(0);
      expect(rule.why.length, rule.key).toBeGreaterThan(40);
    }
  });

  it("names controls that actually exist in the codebase", () => {
    // The enforcement notes cite module and function names. A note citing a
    // function nobody wrote is worse than no note: it reads as a control.
    const root = path.join(process.cwd(), "src");
    const sources = new Map<string, string>();
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
          // Keyed by path, not basename: domain/fees.ts and billing/fees.ts
          // are different files enforcing different halves of the same rule.
          sources.set(path.relative(root, full), readFileSync(full, "utf8"));
        }
      }
    };
    walk(root);

    for (const rule of PROHIBITIONS) {
      for (const note of rule.enforcedBy) {
        const cited = /^([\w/-]+\.tsx?)\s+(\w+)\(\)/.exec(note);
        if (cited === null) continue; // "Structural:" notes carry no citation.
        const file = cited[1] ?? "";
        const fn = cited[2] ?? "";
        const matched = [...sources.entries()].filter(([key]) => key.endsWith(file));
        expect(matched.length, `${rule.key} cites ${file}, which matches no file`).toBeGreaterThan(0);
        expect(
          // Not `${fn}(`: a generic function reads as `rankMatches<T>(`.
          matched.some(([, body]) => body.includes(fn)),
          `${rule.key} cites ${file} ${fn}(), which is in none of them`,
        ).toBe(true);
      }
    }
  });
});

describe("never pretend a discovered property is instructed", () => {
  it("says plainly that nobody has confirmed it, and refuses to sell it", () => {
    expect(categoryDefinition("ai-discovered").disclosure).toContain(
      "Nobody connected to the property has confirmed it is for sale",
    );
    const quote = quoteReveal({
      opportunity: "standard-residential",
      item: { category: "ai-discovered" },
      permissionsHeld: EVERYTHING,
      passport: READY,
    });
    expect(quote.chargeable).toBe(false);
  });
});

describe("never charge a toll on information anybody could look up", () => {
  it("refuses on a property that is openly advertised elsewhere", () => {
    const advertised = quoteReveal({
      opportunity: "owner-verified",
      item: CONFIRMED,
      permissionsHeld: EVERYTHING,
      passport: READY,
      material: MARKETABLE,
      openlyAdvertised: true,
    });
    expect(advertised.chargeable).toBe(false);
    expect(advertised.blockers.map((b) => `${b.reason} ${b.remedy}`).join(" ")).toContain(
      "could have had for nothing",
    );

    // The same opportunity, not advertised, is chargeable — so this is a
    // refusal about the situation rather than a refusal about everything.
    expect(
      quoteReveal({
        opportunity: "owner-verified",
        item: CONFIRMED,
        permissionsHeld: EVERYTHING,
        passport: READY,
        material: MARKETABLE,
      }).chargeable,
    ).toBe(true);
  });
});

describe("never let an unverified lender advertise funds", () => {
  const box = (over: Partial<FundingBox> = {}): FundingBox => {
    const seeded = SEED_FUNDING_BOXES[0];
    if (seeded === undefined) throw new Error("seed funding box missing");
    return { ...seeded, ...over };
  };

  it("fails a hard criterion with no verification recorded", () => {
    const scored = scoreDeal(inputs);
    const unverified = matchFundingBox({ ...box(), verification: undefined }, scored, 10, NOW);
    expect(unverified.eligible).toBe(false);
    expect(unverified.blockers.join(" ")).toContain("Funder verified");
  });

  it("wants evidence with a date and a name, not a flag", () => {
    const good: FunderVerification = {
      verifiedAt: "2026-08-01T00:00:00.000Z",
      verifiedBy: "Jo Bloggs",
      evidence: "Companies House and FCA register checked.",
    };
    expect(funderIsVerified(good, NOW)).toBe(true);
    expect(funderIsVerified({ ...good, verifiedBy: "  " }, NOW)).toBe(false);
    expect(funderIsVerified({ ...good, evidence: "" }, NOW)).toBe(false);
    expect(funderIsVerified({ ...good, verifiedAt: "not a date" }, NOW)).toBe(false);
    // A verification dated in the future is a typo or a fabrication.
    expect(funderIsVerified({ ...good, verifiedAt: "2027-01-01T00:00:00.000Z" }, NOW)).toBe(false);
  });

  it("lapses, because a check from years ago is not a check", () => {
    const stale: FunderVerification = {
      verifiedAt: "2024-01-01T00:00:00.000Z",
      verifiedBy: "Jo Bloggs",
      evidence: "Checked.",
    };
    expect(funderIsVerified(stale, NOW)).toBe(false);
    expect(FUNDER_VERIFICATION_MONTHS).toBe(12);
  });
});

describe("never let software bind anybody", () => {
  it("has four proposal effects and no fifth", () => {
    // An offer is a person committing money. None of the four is "make one".
    const effects = Object.keys(EFFECT_OWNERS) as ProposalEffect[];
    expect(effects.sort()).toEqual(
      ["adopt-conditions-plan", "record-review", "record-selection", "record-sign-off"].sort(),
    );
    for (const effect of effects) {
      expect(effect).not.toContain("offer");
      expect(effect).not.toContain("send");
      expect(effect).not.toContain("accept-price");
    }
  });
});

describe("never rank lenders by what they pay us", () => {
  it("keeps commission out of the matching engine entirely", () => {
    // The failure is invisible: a ranking with a commission term looks exactly
    // like one without, until somebody asks how it was built. So the check is
    // that the engine has no access to the figure at all.
    const engine = readFileSync(
      path.join(process.cwd(), "src/shared/domain/matching.ts"),
      "utf8",
    );
    for (const word of ["commission", "FunderCommission", "rebate", "kickback", "payTo"]) {
      expect(engine, word).not.toContain(word);
    }
    expect(PERMITTED_RANKING_INPUTS.join(" ").toLowerCase()).not.toContain("commission");
  });
});

describe("never hold a purchase deposit", () => {
  it("has no code path that takes one", () => {
    // Client money needs a client account and the rules that come with it. The
    // ledger holds prepaid platform balance and nothing else; this fails if a
    // deposit-taking path is ever added anywhere in the backend or the domain.
    const roots = ["src/shared/domain", "src/backend"];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith(".ts")) continue;
        const body = readFileSync(full, "utf8");
        // Identifiers, not prose: a comment explaining why we do not hold
        // deposits must not fail the test that says we do not.
        if (/\b(holdDeposit|takeDeposit|purchaseDeposit|escrowBalance|clientMoney)\b/.test(body)) {
          offenders.push(full);
        }
      }
    };
    for (const root of roots) walk(path.join(process.cwd(), root));
    expect(offenders).toEqual([]);
  });
});

describe("never describe an estimate as guaranteed", () => {
  it("refuses the vocabulary of certainty around a figure", () => {
    for (const said of [
      "We offer a guaranteed valuation on every property.",
      "The valuation is guaranteed by our surveyors.",
      "A certified valuation of £212,000.",
      "This property will be worth £285,000 after works.",
      "A risk-free way into the Birmingham market.",
    ]) {
      expect(checkValuationLanguage(said).clean, said).toBe(false);
    }
  });

  it("does not flag a promise about our own money", () => {
    // The reveal guarantee is a promise we can keep. Flagging it would train
    // people to ignore this check, which is how a check stops working.
    for (const said of [
      "If the seller does not respond within 7 days, the fee is refunded in full.",
      "Estimated value of £212,000, from three comparables. Not a valuation.",
      "Our engine projects £285,000 after works. It is an estimate, not advice.",
    ]) {
      expect(checkValuationLanguage(said).clean, said).toBe(true);
    }
  });
});

describe("never charge the seller twice, and never reach one unchecked", () => {
  it("has exactly one seller-paid fee, due only on completion", () => {
    const sellerPaid = FEE_DEFINITIONS.filter((f) => f.payer === "seller");
    expect(sellerPaid).toHaveLength(1);
    expect(sellerPaid[0]?.dueAt).toEqual(["completed"]);
  });

  it("keeps grades C and D away from a seller", () => {
    for (const grade of GRADES) {
      expect(grade.mayApproachSeller, grade.grade).toBe(
        grade.grade === "A" || grade.grade === "B",
      );
    }
    expect(prohibition("unchecked-buyer-contact").enforcedBy.join(" ")).toContain(
      "mayApproachSeller()",
    );
  });

  it("refuses to sell an introduction to a buyer nobody has checked", () => {
    const quote = quoteReveal({
      opportunity: "owner-verified",
      item: CONFIRMED,
      permissionsHeld: EVERYTHING,
    });
    expect(quote.chargeable).toBe(false);
    expect(quote.price).toBeGreaterThan(ZERO);
  });
});

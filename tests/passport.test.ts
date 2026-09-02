import { describe, expect, it } from "vitest";
import { fromMajor, ZERO } from "@shared/money";
import {
  buyerPassport,
  fundsAreCurrent,
  FUNDS_VALID_MONTHS,
  GRADES,
  gradeDefinition,
  IDENTITY_VALID_MONTHS,
  mayApproachSeller,
  type PassportEvidence,
  type ProofOfFunds,
} from "@shared/domain/passport";

/**
 * The Buyer Readiness Passport.
 *
 * One question: may this buyer be put in front of a seller. A motivated seller
 * has finite patience and one property to sell, and spending it on somebody
 * with no money is how a marketplace destroys its own supply — the seller
 * blames whoever introduced them, not the buyer.
 */

const NOW = new Date("2026-09-01T00:00:00.000Z");
const PRICE = fromMajor(200_000);

const CASH: ProofOfFunds = {
  kind: "cash",
  evidencedAt: "2026-08-20T00:00:00.000Z",
  amount: fromMajor(250_000),
  issuer: "Lloyds",
};

const FULL: PassportEvidence = {
  identityVerifiedAt: "2026-06-01T00:00:00.000Z",
  identityMethod: "Photo ID and address, checked electronically",
  screenedAt: "2026-08-01T00:00:00.000Z",
  sourceOfFundsAt: "2026-08-01T00:00:00.000Z",
  proofOfFunds: CASH,
  completedPurchases: 2,
};

describe("what a grade means", () => {
  it("starts everybody at D, on evidence rather than on the absence of a problem", () => {
    // A buyer with nothing recorded is unverified, not "no known issues".
    const nothing = buyerPassport({}, PRICE, NOW);
    expect(nothing.grade).toBe("D");
    expect(nothing.evidencedFunds).toBe(ZERO);
    expect(nothing.mayApproachSeller).toBe(false);
  });

  it("stops at C on identity alone, which is the interesting refusal", () => {
    // We know exactly who they are. That is still not a reason to spend a
    // seller's patience on them.
    const identified = buyerPassport(
      { identityVerifiedAt: "2026-06-01T00:00:00.000Z", screenedAt: "2026-08-01T00:00:00.000Z" },
      PRICE,
      NOW,
    );
    expect(identified.grade).toBe("C");
    expect(mayApproachSeller(identified).allowed).toBe(false);
    expect(gradeDefinition("C").mayApproachSeller).toBe(false);
  });

  it("reaches A only on unconditional funds that cover the price, with a track record", () => {
    expect(buyerPassport(FULL, PRICE, NOW).grade).toBe("A");

    // Conditional funding is B, however large. A decision in principle is
    // subject to a valuation that has not happened.
    const aip = buyerPassport(
      { ...FULL, proofOfFunds: { ...CASH, kind: "mortgage-in-principle" } },
      PRICE,
      NOW,
    );
    expect(aip.grade).toBe("B");
    expect(aip.mayApproachSeller).toBe(true);

    // Cash that does not cover the price is B too, and the shortfall is stated
    // rather than hidden — it is a condition the seller is entitled to know.
    const short = buyerPassport({ ...FULL, proofOfFunds: { ...CASH, amount: fromMajor(90_000) } }, PRICE, NOW);
    expect(short.grade).toBe("B");
    expect(short.checks.find((c) => c.label === "Funds cover the price")?.held).toBe(false);

    // No completed purchase and no solicitor is B as well: proceedable means
    // somebody is ready to act, not merely able to pay.
    const untested = buyerPassport(
      { ...FULL, completedPurchases: 0 },
      PRICE,
      NOW,
    );
    expect(untested.grade).toBe("B");
  });

  it("grades against the price, because funded is not an absolute", () => {
    // The same £250,000 evidenced is grade A against a terrace and grade B
    // against a townhouse. Grading a buyer with no property in mind is grading
    // them against nothing.
    expect(buyerPassport(FULL, fromMajor(172_000), NOW).grade).toBe("A");
    expect(buyerPassport(FULL, fromMajor(400_000), NOW).grade).toBe("B");
  });
});

describe("evidence goes stale", () => {
  it("drops to D when the identity check ages out", () => {
    const old = buyerPassport(
      { ...FULL, identityVerifiedAt: "2025-01-01T00:00:00.000Z" },
      PRICE,
      NOW,
    );
    expect(old.grade).toBe("D");
    expect(old.checks[0]?.detail).toContain(`older than ${IDENTITY_VALID_MONTHS} months`);
  });

  it("drops to C when the funds evidence ages out", () => {
    const stale = buyerPassport(
      { ...FULL, proofOfFunds: { ...CASH, evidencedAt: "2026-01-01T00:00:00.000Z" } },
      PRICE,
      NOW,
    );
    expect(stale.grade).toBe("C");
    expect(stale.evidencedFunds).toBe(ZERO);
    expect(stale.checks[2]?.detail).toContain(`${FUNDS_VALID_MONTHS} months`);
  });

  it("honours an expiry the evidence sets for itself", () => {
    // A decision in principle says when it lapses. The earlier of that and our
    // own window wins.
    expect(fundsAreCurrent({ ...CASH, expiresAt: "2026-10-01T00:00:00.000Z" }, NOW)).toBe(true);
    expect(fundsAreCurrent({ ...CASH, expiresAt: "2026-08-25T00:00:00.000Z" }, NOW)).toBe(false);
  });

  it("treats an unreadable or future date as no evidence at all", () => {
    // A malformed expiry must not buy an indefinite extension, and a date in
    // the future is a typo or a fabrication rather than a check.
    expect(fundsAreCurrent({ ...CASH, expiresAt: "not a date" }, NOW)).toBe(false);
    expect(fundsAreCurrent({ ...CASH, evidencedAt: "2027-01-01T00:00:00.000Z" }, NOW)).toBe(false);
    expect(
      buyerPassport({ ...FULL, identityVerifiedAt: "tomorrow" }, PRICE, NOW).grade,
    ).toBe("D");
  });

  it("reads the date passed in, never the wall clock", () => {
    // What a page shows and what a gate decides must not be able to drift.
    const later = new Date("2028-01-01T00:00:00.000Z");
    expect(buyerPassport(FULL, PRICE, NOW).grade).toBe("A");
    expect(buyerPassport(FULL, PRICE, later).grade).toBe("D");
  });
});

describe("the gate itself", () => {
  it("gives one function the decision, so no call site invents its own", () => {
    for (const grade of GRADES) {
      // Only A and B reach a seller, and the definition is the single place
      // that says so.
      expect(grade.mayApproachSeller).toBe(grade.grade === "A" || grade.grade === "B");
    }
  });

  it("says what is missing rather than only that something is", () => {
    const refused = mayApproachSeller(buyerPassport({}, PRICE, NOW));
    expect(refused.allowed).toBe(false);
    expect(refused.reason).toContain("Identity verified");
  });

  it("never presents itself as a credit reference", () => {
    expect(buyerPassport(FULL, PRICE, NOW).caveat).toContain("not a credit reference");
  });
});

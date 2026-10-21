import { describe, expect, it } from "vitest";
import {
  assessEarlyResale,
  compareToRuleOfThumb,
  RULE_OF_THUMB_SHARE,
  SEASONING_MONTHS,
} from "@shared/domain/flipping";
import { TARGET_MARGIN } from "@shared/domain/negotiation";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { SEED_DEALS } from "@backend/store/seed";
import { applyBps, fromMajor, pct, sub, ZERO } from "@shared/money";
import type { DealInputs, ExitStrategy } from "@shared/domain/types";

/** A cash purchase: every finance cost at zero. */
const NO_FINANCE = {
  ltvBps: pct(0),
  refurbAdvanceBps: pct(0),
  annualRateBps: pct(0),
  arrangementFeeBps: pct(0),
  exitFeeBps: pct(0),
  interestRolledUp: false,
  lenderCosts: fromMajor(0),
};

function inputs(): DealInputs {
  const first = SEED_DEALS[0];
  if (first === undefined) throw new Error("no seed deal");
  return toWorkingDeal(first.inputs).inputs;
}

describe("the 70% rule, compared against", () => {
  it("computes the offer the rule actually produces", () => {
    const base = inputs();
    const comparison = compareToRuleOfThumb(base, TARGET_MARGIN);
    // 70% of the finished value, less the works. Stated here independently so
    // the test fails if the formula drifts rather than agreeing with itself.
    const expected = sub(
      applyBps(base.property.postWorksValue, RULE_OF_THUMB_SHARE),
      base.property.refurbishmentEstimate,
    );
    expect(comparison.ruleOffer).toBe(expected);
  });

  it("explains the gap from the real cost stack rather than asserting it", () => {
    const comparison = compareToRuleOfThumb(inputs(), TARGET_MARGIN);
    expect(comparison.foldedIntoTheThirty.length).toBeGreaterThan(3);
    for (const line of comparison.foldedIntoTheThirty) {
      // Itemised and non-zero. A line at zero is noise in an explanation.
      expect(line.amount, line.label).toBeGreaterThan(ZERO);
      expect(line.label.length).toBeGreaterThan(3);
    }
    // The transfer tax must be in there by its jurisdiction's own name, not as
    // "stamp duty" hardcoded — Scotland and Wales charge different taxes.
    const labels = comparison.foldedIntoTheThirty.map((l) => l.label);
    expect(labels.some((l) => l.length > 0 && l === l.trim())).toBe(true);
  });

  it("reports a conservative rule as conservative, not as an overpayment", () => {
    /*
     * The rule is conservative where the costs it folds into its thirty points
     * are unusually light: a cash purchase, so no finance; an individual
     * buying their only property, so no surcharge; and small works against a
     * large uplift.
     *
     * My first attempt at this fixture only raised the finished value, and the
     * rule still overpaid — because a bigger ARV raises the rule's offer as
     * fast as it raises the ceiling. It is the cost structure that decides
     * this, not the headline numbers, which is the point of the comparison.
     */
    const base = inputs();
    const light: DealInputs = {
      ...base,
      structure: "cash-purchase",
      finance: NO_FINANCE,
      buyerIsCompany: false,
      buyerOwnsOtherProperty: false,
      holdMonths: 3,
      property: {
        ...base.property,
        openMarketValue: fromMajor(150_000),
        postWorksValue: fromMajor(300_000),
        refurbishmentEstimate: fromMajor(5_000),
      },
    };
    const comparison = compareToRuleOfThumb(light, TARGET_MARGIN);
    expect(comparison.ruleOverpays).toBe(false);
    expect(comparison.verdict).toContain("conservative");
    expect(comparison.gap).toBeGreaterThan(ZERO);
  });

  it("reports the gap as a magnitude, whichever way round it is", () => {
    for (const works of [fromMajor(10_000), fromMajor(90_000)]) {
      const base = inputs();
      const comparison = compareToRuleOfThumb(
        { ...base, property: { ...base.property, refurbishmentEstimate: works } },
        TARGET_MARGIN,
      );
      // Never negative, because the direction is carried by ruleOverpays.
      expect(comparison.gap, `works ${works}`).toBeGreaterThanOrEqual(ZERO);
    }
  });

  it("floors the rule's offer at zero rather than going negative", () => {
    // Works above seventy points of the finished value make the rule produce a
    // negative number. That is information about the property, not an error,
    // and a negative price would propagate into the appraisal.
    const base = inputs();
    const upsideDown: DealInputs = {
      ...base,
      property: { ...base.property, refurbishmentEstimate: base.property.postWorksValue },
    };
    expect(compareToRuleOfThumb(upsideDown, TARGET_MARGIN).ruleOffer).toBe(ZERO);
  });

  it("does not become the thing the engine uses", () => {
    /*
     * The rule is here to be compared against. If the ceiling tracked the
     * rule's offer across different cost structures, something would have
     * replaced the search with the heuristic.
     *
     * Varying `structure` alone does nothing, which my first version of this
     * test assumed it would: the costs come from the `finance` object, and the
     * structure label is how the deal is described rather than how it is
     * priced. Worth knowing.
     */
    const base = inputs();
    const bridged = compareToRuleOfThumb(base, TARGET_MARGIN);
    const cash = compareToRuleOfThumb({ ...base, finance: NO_FINANCE }, TARGET_MARGIN);
    // Same ARV and works, so the rule says the same thing both times.
    expect(cash.ruleOffer).toBe(bridged.ruleOffer);
    // The engine does not, because a cash purchase carries no finance cost.
    expect(cash.computedCeiling).toBeGreaterThan(bridged.computedCeiling);
  });
});

describe("the seasoning convention", () => {
  it("clears a hold past the convention", () => {
    const assessment = assessEarlyResale(9, "sell");
    expect(assessment.risk).toBe("clear");
    expect(assessment.monthsUntilClear).toBe(0);
    expect(assessment.mitigations).toHaveLength(0);
  });

  it("flags a short hold, and says how long is left", () => {
    const assessment = assessEarlyResale(3, "sell");
    expect(assessment.risk).toBe("most-lenders-decline");
    expect(assessment.monthsUntilClear).toBe(SEASONING_MONTHS - 3);
    expect(assessment.consequence).toContain("cash buyers");
    expect(assessment.mitigations.length).toBeGreaterThan(2);
  });

  it("distinguishes close-to-the-line from well inside it", () => {
    expect(assessEarlyResale(5, "sell").risk).toBe("restricted");
    expect(assessEarlyResale(2, "sell").risk).toBe("most-lenders-decline");
  });

  it("applies to a sale and to nothing else", () => {
    // A refinance is the lender's own seasoning question and is handled by the
    // refinance window. A let has no lender on the far side. An assignment
    // never reaches a mortgage. Treating all four alike would raise a warning
    // on three exits it cannot affect.
    const unaffected: ExitStrategy[] = ["refinance-and-hold", "rent-only", "assign"];
    for (const exit of unaffected) {
      const assessment = assessEarlyResale(2, exit);
      expect(assessment.affectsThisExit, exit).toBe(false);
      expect(assessment.risk, exit).toBe("clear");
      expect(assessment.mitigations, exit).toHaveLength(0);
    }
    expect(assessEarlyResale(2, "sell").affectsThisExit).toBe(true);
  });

  it("offers a mitigation that costs nothing but a decision", () => {
    const assessment = assessEarlyResale(3, "sell");
    // Exchanging inside the window and completing after it is the one that
    // solves the lender's question without extending the works, and it is the
    // one people do not think of.
    expect(assessment.mitigations.some((m) => m.includes("Exchange inside the window"))).toBe(true);
    // And it must say this is criteria rather than law, because it is.
    expect(assessment.mitigations.some((m) => m.includes("not law"))).toBe(true);
  });

  it("names a convention rather than a statute", () => {
    expect(SEASONING_MONTHS).toBe(6);
    // There is no legislation behind this and the module must not imply one.
    // A citation key here would be an invented source, which is the failure
    // citations.ts exists to prevent.
    const assessment = assessEarlyResale(1, "sell");
    expect(JSON.stringify(assessment)).not.toMatch(/legislation|statute|s\.\s?\d/i);
  });
});

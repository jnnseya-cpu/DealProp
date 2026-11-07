import { describe, expect, it } from "vitest";
import { fromMajor, ratioBps, sub } from "@shared/money";

/**
 * Property Sourcing spec §7 / acceptance A07.
 *
 * The worked illustration: exit £250,000, purchase £150,000, and modelled costs
 * (tax £8,000, legal/survey £3,000, sourcing £5,000, works £30,000, contingency
 * £3,000, finance/holding £12,000, exit £5,000) sum with the purchase to a total
 * project cost of £216,000 and a profit before entity/personal tax of £34,000.
 * Against a reviewed as-is value of £190,000 the gross discount is a *separate*
 * measure.
 *
 * The spec is emphatic that profit-on-cost and gross-discount are **distinct**
 * and must not be conflated (do not call the gap between today's price and the
 * refurbished value a "current discount"). This pins both, through the engine's
 * own `ratioBps` — the exact function `appraise()` uses for `profitOnCostBps`
 * (profit / total cost) and `discountToOmvBps` ((OMV − price) / OMV) — so a
 * change to the ratio semantics breaks this, not only the engine's internals.
 */

describe("A07 — the §7 worked illustration", () => {
  const exit = fromMajor(250_000);
  const purchase = fromMajor(150_000);
  const asIsValue = fromMajor(190_000);

  // The modelled costs of the illustration, beside the purchase price.
  const costsBesidePurchase = [8_000, 3_000, 5_000, 30_000, 3_000, 12_000, 5_000];
  const totalCost = fromMajor(150_000 + costsBesidePurchase.reduce((a, b) => a + b, 0));
  const profit = sub(exit, totalCost);

  it("totals £216,000 of cost and £34,000 of profit", () => {
    expect(totalCost).toBe(fromMajor(216_000));
    expect(profit).toBe(fromMajor(34_000));
  });

  it("reports profit-on-cost of 15.74%, the engine's profit ÷ total", () => {
    // 34,000 / 216,000 = 0.157407… → 1574 bps.
    expect(ratioBps(profit, totalCost)).toBe(1574);
  });

  it("reports a gross discount of 21.05%, a separate measure of (OMV − price) ÷ OMV", () => {
    // 40,000 / 190,000 = 0.210526… → 2105 bps. Distinct from profit-on-cost:
    // the two must never be conflated into one "discount".
    expect(ratioBps(sub(asIsValue, purchase), asIsValue)).toBe(2105);
    expect(ratioBps(sub(asIsValue, purchase), asIsValue)).not.toBe(ratioBps(profit, totalCost));
  });
});

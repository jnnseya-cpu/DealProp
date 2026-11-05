import { describe, expect, it } from "vitest";
import { fromMajor } from "@shared/money";
import {
  DEAL_HUNT_DEFAULTS,
  DEAL_HUNT_RESULT_CAP,
  validateCriteria,
  withinPriceCeiling,
  type CriteriaDraft,
} from "@shared/domain/dealHunt";

const base: CriteriaDraft = { geographyId: "pilot-birmingham", askingPriceLimitPence: 22_500_000 };

describe("validating Deal Hunt criteria (§2 / DH02)", () => {
  it("requires a geography and a price ceiling", () => {
    expect(validateCriteria({ askingPriceLimitPence: 22_500_000 }).ok).toBe(false); // no geography
    expect(validateCriteria({ geographyId: "pilot-birmingham" }).ok).toBe(false); // no price
    const neither = validateCriteria({});
    expect(neither.ok).toBe(false);
    if (!neither.ok) expect(neither.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("applies the visible defaults when a valid draft omits them", () => {
    const result = validateCriteria(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.criteria.returnedWithinDays).toBe(DEAL_HUNT_DEFAULTS.returnedWithinDays);
    expect(result.criteria.resultLimit).toBe(DEAL_HUNT_DEFAULTS.resultLimit);
    expect(result.criteria.eventRequirement).toBe("returned_to_market");
    expect(result.criteria.evidenceSections).toEqual(["sold", "rent"]);
  });

  it("rejects out-of-range and contradictory criteria", () => {
    expect(validateCriteria({ ...base, returnedWithinDays: 0 }).ok).toBe(false);
    expect(validateCriteria({ ...base, returnedWithinDays: 400 }).ok).toBe(false);
    expect(validateCriteria({ ...base, minimumDropBps: 20_000 }).ok).toBe(false);
    expect(validateCriteria({ ...base, resultLimit: DEAL_HUNT_RESULT_CAP + 1 }).ok).toBe(false);
    expect(validateCriteria({ ...base, askingPriceLimitPence: -1 }).ok).toBe(false);
    expect(validateCriteria({ ...base, bedroomsMin: 4, bedroomsMax: 2 }).ok).toBe(false);
  });

  it("caps the result limit and keeps a valid one", () => {
    const r = validateCriteria({ ...base, resultLimit: 50 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.criteria.resultLimit).toBe(50);
  });
});

describe("the price ceiling operator", () => {
  it("maps 'under' to a strict less-than, and lte includes the ceiling", () => {
    const lt = validateCriteria({ ...base, priceOperator: "lt" });
    const lte = validateCriteria({ ...base, priceOperator: "lte" });
    expect(lt.ok && lte.ok).toBe(true);
    if (!lt.ok || !lte.ok) return;
    expect(withinPriceCeiling(fromMajor(225_000), lt.criteria)).toBe(false);
    expect(withinPriceCeiling(fromMajor(225_000), lte.criteria)).toBe(true);
    expect(withinPriceCeiling(fromMajor(224_999), lt.criteria)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { dealOriginLabel } from "@shared/domain/dealOrigin";

describe("dealOriginLabel", () => {
  it("uses the recorded origin when present", () => {
    expect(dealOriginLabel({ origin: { via: "sell" } })).toMatch(/public sell form/);
    expect(dealOriginLabel({ origin: { via: "sourcing", note: "probate-notice" } })).toMatch(
      /sourced register lead \(probate notice\)/,
    );
    expect(dealOriginLabel({ origin: { via: "seed" } })).toMatch(/Demonstration data/);
  });

  it("derives a seller submission from an enq- id when origin is absent", () => {
    const label = dealOriginLabel({ id: "enq-abc123" });
    expect(label).toMatch(/public sell form/);
    expect(label).toMatch(/Derived/);
  });

  it("derives a sourced lead from a deal- id and its narrative", () => {
    const label = dealOriginLabel({
      id: "deal-xyz",
      narrative: "Started from a Gazette probate notice. Estate of A. Property: 1 High St.",
    });
    expect(label).toMatch(/Started from a Gazette probate notice\./);
    expect(label).toMatch(/Derived/);
  });

  it("says plainly when it cannot tell", () => {
    expect(dealOriginLabel({ id: "something-else" })).toMatch(/not separately recorded/);
  });
});

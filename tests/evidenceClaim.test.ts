import { describe, expect, it } from "vitest";
import { missingClaim, reviseClaim, type EvidenceClaim } from "@shared/domain/evidenceClaim";

const seed: EvidenceClaim = {
  id: "c1",
  tenantId: "lode",
  propertyId: "p1",
  field: "tenure",
  value: "leasehold",
  sourceType: "user",
  sourceLocator: "intake:123",
  effectiveAt: "2026-06-01T00:00:00.000Z",
  observedAt: "2026-06-01T00:00:00.000Z",
  confidence: "user_reported",
  entitlement: "pilot",
  revision: 1,
};

describe("EvidenceClaim (Independent Engine §5)", () => {
  it("revises into a new superseding record without mutating the original", () => {
    const next = reviseClaim(seed, { value: "freehold", confidence: "confirmed", sourceType: "registry" }, {
      id: "c2",
      observedAt: "2026-06-10T00:00:00.000Z",
    });
    expect(next.id).toBe("c2");
    expect(next.revision).toBe(2);
    expect(next.supersedesId).toBe("c1");
    expect(next.value).toBe("freehold");
    expect(next.confidence).toBe("confirmed");
    // original unchanged
    expect(seed.value).toBe("leasehold");
    expect(seed.revision).toBe(1);
  });

  it("records an absent fact as missing, with who was asked", () => {
    const m = missingClaim({
      id: "m1",
      tenantId: "lode",
      propertyId: "p1",
      field: "covenants",
      sourceType: "conveyancer",
      sourceLocator: "request:9",
      observedAt: "2026-06-02T00:00:00.000Z",
      entitlement: "pilot",
    });
    expect(m.confidence).toBe("missing");
    expect(m.value).toBe("");
    expect(m.sourceLocator).toBe("request:9");
  });
});

import { describe, expect, it } from "vitest";
import { approvalStatus, stableStringify, PACK_VERSION, type PackApproval } from "@shared/domain/packApproval";
import { packContentHash } from "@backend/packApproval";

describe("stableStringify", () => {
  it("is independent of key order", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(stableStringify({ x: { p: 1, q: 2 } })).toBe(stableStringify({ x: { q: 2, p: 1 } }));
  });
  it("changes when a value changes", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});

describe("packContentHash", () => {
  const base = {
    inputs: { purchasePrice: 150_000, structure: "cash-purchase" },
    material: { tenure: "freehold" },
  };

  it("is deterministic and order-independent", () => {
    expect(packContentHash(base)).toBe(
      packContentHash({ material: { tenure: "freehold" }, inputs: { structure: "cash-purchase", purchasePrice: 150_000 } }),
    );
  });

  it("changes when the price changes", () => {
    const changed = packContentHash({ ...base, inputs: { purchasePrice: 140_000, structure: "cash-purchase" } });
    expect(changed).not.toBe(packContentHash(base));
  });

  it("changes when a material fact changes", () => {
    const changed = packContentHash({ ...base, material: { tenure: "leasehold" } });
    expect(changed).not.toBe(packContentHash(base));
  });
});

describe("approvalStatus — the A08 freeze", () => {
  const base = { inputs: { purchasePrice: 150_000 }, material: { tenure: "freehold" } };
  const hash = packContentHash(base);
  const approval: PackApproval = {
    contentHash: hash,
    approvedBy: "Jo Operator",
    approvedAt: "2026-06-01T09:00:00Z",
    packVersion: PACK_VERSION,
  };

  it("is 'none' before approval", () => {
    expect(approvalStatus(hash, undefined).state).toBe("none");
  });

  it("is 'valid' while the content matches what was approved", () => {
    const s = approvalStatus(hash, approval);
    expect(s.state).toBe("valid");
    expect(s.reason).toMatch(/Jo Operator/);
  });

  it("goes 'stale' the moment the content changes, voiding the approval", () => {
    const afterPriceChange = packContentHash({ ...base, inputs: { purchasePrice: 140_000 } });
    const s = approvalStatus(afterPriceChange, approval);
    expect(s.state).toBe("stale");
    expect(s.reason).toMatch(/void/i);
  });
});

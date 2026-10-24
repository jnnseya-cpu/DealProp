import { describe, expect, it } from "vitest";
import {
  DRAFT_EXCLUDED,
  DRAFT_FIELDS,
  DRAFT_KEY,
  clearDraft,
  loadDraft,
  pickDraftValues,
  saveDraft,
} from "../src/app/sell/draft";

/**
 * The point of these tests is the privacy guarantee, not the convenience. The
 * draft must never carry a special-category answer or the free-text narrative
 * onto the device, in either direction, however the stored value got there.
 */

/** A minimal in-memory Storage, enough for save/load/clear. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

/** A Storage that throws on everything, like a locked-down private window. */
function hostileStorage(): Storage {
  const bang = () => {
    throw new Error("blocked");
  };
  return {
    length: 0,
    clear: bang,
    getItem: bang,
    key: bang,
    removeItem: bang,
    setItem: bang,
  };
}

describe("seller draft allowlist", () => {
  it("never lets the allowlist and the excluded (sensitive) set overlap", () => {
    for (const sensitive of DRAFT_EXCLUDED) {
      expect(DRAFT_FIELDS as readonly string[]).not.toContain(sensitive);
    }
  });

  it("keeps allowlisted fields and drops everything else", () => {
    const values = pickDraftValues([
      ["situation", "probate"],
      ["postcodeArea", "B23"],
      ["sellerValuation", "212,000"],
      ["priorities", "speed"],
      ["priorities", "certainty"],
      // sensitive — must all be dropped:
      ["narrative", "I am behind on the mortgage and unwell."],
      ["reportsHealthOrCapacityConcern", "yes"],
      ["reportsFinancialDistress", "yes"],
      ["ageBand", "80-plus"],
      ["ownerAffirmed", "yes"],
    ]);
    expect(values.situation).toBe("probate");
    expect(values.postcodeArea).toBe("B23");
    expect(values.priorities).toEqual(["speed", "certainty"]);
    expect(values.narrative).toBeUndefined();
    expect(values.reportsHealthOrCapacityConcern).toBeUndefined();
    expect(values.reportsFinancialDistress).toBeUndefined();
    expect(values.ageBand).toBeUndefined();
    expect(values.ownerAffirmed).toBeUndefined();
  });

  it("drops empty values", () => {
    const values = pickDraftValues([
      ["postcodeArea", ""],
      ["locality", "Erdington"],
    ]);
    expect(values.postcodeArea).toBeUndefined();
    expect(values.locality).toBe("Erdington");
  });

  it("round-trips a draft through storage", () => {
    const s = memoryStorage();
    saveDraft({ v: 1, step: 3, values: { situation: "divorce", priorities: ["price"] } }, s);
    const back = loadDraft(s);
    expect(back?.step).toBe(3);
    expect(back?.values.situation).toBe("divorce");
    expect(back?.values.priorities).toEqual(["price"]);
  });

  it("will not save a sensitive field even if asked to", () => {
    const s = memoryStorage();
    // A caller passing sensitive values is still filtered on the way in.
    saveDraft(
      { v: 1, step: 4, values: { situation: "probate", narrative: "secret", reportsHealthOrCapacityConcern: "yes" } },
      s,
    );
    const stored = s.getItem(DRAFT_KEY) ?? "";
    expect(stored).toContain("probate");
    expect(stored).not.toContain("secret");
    expect(stored).not.toContain("reportsHealthOrCapacityConcern");
  });

  it("re-filters a tampered stored draft on load", () => {
    const s = memoryStorage();
    // Simulate something writing a sensitive field straight into storage.
    s.setItem(
      DRAFT_KEY,
      JSON.stringify({ v: 1, step: 1, values: { situation: "probate", narrative: "injected", reportsFinancialDistress: "yes" } }),
    );
    const back = loadDraft(s);
    expect(back?.values.situation).toBe("probate");
    expect(back?.values.narrative).toBeUndefined();
    expect(back?.values.reportsFinancialDistress).toBeUndefined();
  });

  it("ignores a malformed or wrong-version stored draft", () => {
    const s = memoryStorage();
    s.setItem(DRAFT_KEY, "not json");
    expect(loadDraft(s)).toBeUndefined();
    s.setItem(DRAFT_KEY, JSON.stringify({ v: 2, step: 0, values: {} }));
    expect(loadDraft(s)).toBeUndefined();
  });

  it("never throws on a hostile storage", () => {
    const s = hostileStorage();
    expect(() => saveDraft({ v: 1, step: 0, values: { situation: "probate" } }, s)).not.toThrow();
    expect(loadDraft(s)).toBeUndefined();
    expect(() => clearDraft(s)).not.toThrow();
  });

  it("clears the draft", () => {
    const s = memoryStorage();
    saveDraft({ v: 1, step: 0, values: { situation: "probate" } }, s);
    clearDraft(s);
    expect(loadDraft(s)).toBeUndefined();
  });
});

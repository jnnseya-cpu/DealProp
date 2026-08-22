import { describe, expect, it } from "vitest";
import { fromMajor, toMajor } from "@shared/money";
import {
  checkbox,
  manyOf,
  optionalMoney,
  requireManyOf,
  requireOneOf,
  requiredInteger,
  requiredMoney,
  requiredPercent,
  requiredText,
  textList,
} from "@shared/formFields";

const ALLOWED = new Set(["a", "b", "c"]);

describe("choices", () => {
  it("accepts an allowed value and rejects anything else", () => {
    expect(requireOneOf("a", ALLOWED, "field")).toBe("a");
    expect(() => requireOneOf("z", ALLOWED, "field")).toThrow(/field/);
    expect(() => requireOneOf(null, ALLOWED, "field")).toThrow(/field/);
  });

  it("keeps only allowed values from a multi-select, deduplicated", () => {
    expect(manyOf(["a", "z", "b", "a"], ALLOWED)).toEqual(["a", "b"]);
  });

  it("requires at least one value where the field is mandatory", () => {
    expect(() => requireManyOf(["z"], ALLOWED, "thing")).toThrow(/at least one thing/);
  });
});

describe("money", () => {
  it("strips currency formatting a person would actually type", () => {
    const value = optionalMoney("£212,000");
    expect(value).not.toBeUndefined();
    expect(toMajor(value ?? fromMajor(0))).toBe(212_000);
  });

  it("treats blank, zero and negative as absent", () => {
    expect(optionalMoney("")).toBeUndefined();
    expect(optionalMoney("0")).toBeUndefined();
    expect(optionalMoney("-5")).toBeUndefined();
  });

  it("names the field when a required amount is missing", () => {
    expect(() => requiredMoney("", "Minimum price")).toThrow(/Minimum price/);
  });
});

describe("integers", () => {
  it("accepts zero, which is a real answer for several mandate fields", () => {
    // A minimum bedroom count or a required track record of zero is meaningful;
    // optionalNumber treats zero as absent, which is why this exists.
    expect(requiredInteger("0", "Track record", { min: 0, max: 100 })).toBe(0);
  });

  it("rejects values outside the range and non-numbers", () => {
    expect(() => requiredInteger("101", "Score", { min: 0, max: 100 })).toThrow(/between 0 and 100/);
    expect(() => requiredInteger("abc", "Score", { min: 0, max: 100 })).toThrow(/must be a number/);
  });
});

describe("percentages", () => {
  it("converts a typed percentage to basis points", () => {
    // Forms ask for "15" because that is what a funder says; the engine works
    // in basis points throughout.
    expect(requiredPercent("15", "Margin")).toBe(1_500);
    expect(requiredPercent("9.6", "Rate")).toBe(960);
    expect(requiredPercent("70%", "LTV")).toBe(7_000);
  });

  it("rejects anything outside 0-100", () => {
    expect(() => requiredPercent("120", "LTV")).toThrow(/between 0 and 100/);
    expect(() => requiredPercent("-1", "LTV")).toThrow(/between 0 and 100/);
  });
});

describe("text", () => {
  it("rejects empty text and trims what it keeps", () => {
    expect(requiredText("  Marchmont  ", "Name")).toBe("Marchmont");
    expect(() => requiredText("   ", "Name")).toThrow(/Name is required/);
  });

  it("caps a list in both length and count", () => {
    expect(textList("Erdington, Handsworth ,, Aston")).toEqual([
      "Erdington",
      "Handsworth",
      "Aston",
    ]);
    expect(textList(null)).toEqual([]);
    expect(textList(Array.from({ length: 60 }, (_, i) => `x${i}`).join(",")).length).toBe(40);
  });
});

describe("checkboxes", () => {
  it("treats an absent checkbox as false", () => {
    // An unticked checkbox submits nothing at all. Reading that as anything
    // other than false would silently activate mandates nobody activated.
    expect(checkbox(null)).toBe(false);
    expect(checkbox("on")).toBe(true);
  });
});

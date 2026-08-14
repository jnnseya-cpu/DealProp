import { describe, expect, it } from "vitest";
import { add, applyBps, bps, fromMajor, money, pct, ratioBps, scale, sub, toMajor } from "@/lib/money";

describe("money", () => {
  it("rejects non-integer minor units", () => {
    expect(() => money(10.5)).toThrow(RangeError);
  });

  it("rejects non-finite values", () => {
    expect(() => money(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => money(Number.NaN)).toThrow(RangeError);
  });

  it("round-trips major units", () => {
    expect(toMajor(fromMajor(280_000))).toBe(280_000);
    expect(fromMajor(1234.56)).toBe(123_456);
  });

  it("adds without floating point drift", () => {
    // 0.1 + 0.2 in float is 0.30000000000000004; in pence it is exact.
    const total = add(fromMajor(0.1), fromMajor(0.2));
    expect(total).toBe(30);
  });

  it("accumulates a thousand small amounts exactly", () => {
    const parts = Array.from({ length: 1000 }, () => fromMajor(0.07));
    expect(add(...parts)).toBe(7_000);
  });

  it("rounds half away from zero symmetrically", () => {
    // 5 pence at 50% is 2.5, which must round to 3, and -5 to -3.
    expect(applyBps(money(5), pct(50))).toBe(3);
    expect(applyBps(money(-5), pct(50))).toBe(-3);
  });

  it("scales symmetrically about zero", () => {
    expect(scale(money(5), 0.5)).toBe(3);
    expect(scale(money(-5), 0.5)).toBe(-3);
  });

  it("converts percentages to basis points", () => {
    expect(pct(5.5)).toBe(550);
    expect(pct(100)).toBe(10_000);
  });

  it("returns zero rather than Infinity for a zero denominator", () => {
    expect(ratioBps(fromMajor(100), money(0))).toBe(0);
  });

  it("computes ratios in basis points", () => {
    expect(ratioBps(fromMajor(25), fromMajor(100))).toBe(2_500);
  });

  it("subtracts into negative amounts", () => {
    expect(sub(fromMajor(100), fromMajor(150))).toBe(fromMajor(-50));
  });

  it("treats bps as integers", () => {
    expect(bps(250.4)).toBe(250);
  });
});

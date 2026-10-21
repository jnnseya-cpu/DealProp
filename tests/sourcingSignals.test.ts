import { describe, expect, it } from "vitest";
import {
  blockedSignals,
  computableSignals,
  signalCoverage,
  sourcingSignal,
  SOURCING_SIGNALS,
  type SignalAvailability,
} from "@shared/domain/sourcingSignals";

describe("the strategy filter taxonomy", () => {
  it("names the sourcing signals a user would expect", () => {
    const keys = new Set(SOURCING_SIGNALS.map((s) => s.key));
    // The headline Dryv-style filters must all be acknowledged, even the ones
    // we cannot yet run — an unlisted filter is a worse answer than a refused
    // one.
    for (const key of ["probate", "repossessed", "no-chain", "back-and-reduced", "withdrawn-recently", "needs-work"]) {
      expect(keys.has(key as never), key).toBe(true);
    }
  });

  it("gives every signal a unique key, a meaning and a source", () => {
    const keys = SOURCING_SIGNALS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const signal of SOURCING_SIGNALS) {
      expect(signal.meaning.length, signal.key).toBeGreaterThan(30);
      expect(signal.source.length, signal.key).toBeGreaterThan(20);
    }
  });

  it("never claims a portal fact is computable from open data", () => {
    // The whole honesty of the register. A listing fact must declare it needs
    // a feed, and its source must not describe a workaround.
    const portalFacts = ["back-and-reduced", "withdrawn-recently", "sold-stc-stalled", "repossessed"];
    for (const key of portalFacts) {
      const signal = sourcingSignal(key as never);
      expect(signal.availability, key).toBe("needs-portal-feed");
      expect(signal.source.toLowerCase(), key).not.toContain("scrap");
    }
  });

  it("marks a blocked signal's source as a licence or a conversation, never a crawl", () => {
    for (const signal of blockedSignals()) {
      const source = signal.source.toLowerCase();
      expect(source, signal.key).not.toContain("scrape");
      expect(source, signal.key).not.toContain("crawl");
    }
  });

  it("only calls a signal computable when a licensed source produces it", () => {
    // Each computable signal names Price Paid, the EPC register or Companies
    // House — the three we hold a licence for — rather than a portal.
    const licensed = /price paid|epc|companies house|empty-homes|corporate ownership|local authority/i;
    for (const signal of computableSignals()) {
      expect(licensed.test(signal.source), `${signal.key}: ${signal.source}`).toBe(true);
    }
  });

  it("reports coverage honestly and adds up", () => {
    const coverage = signalCoverage();
    const counts: Record<SignalAvailability, number> = {
      computable: coverage.computable,
      "needs-portal-feed": coverage.needsPortalFeed,
      "from-seller": coverage.fromSeller,
      "needs-title": coverage.needsTitle,
    };
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(coverage.total);
    expect(coverage.total).toBe(SOURCING_SIGNALS.length);
    // The summary must state the gap, not hide it.
    expect(coverage.summary).toContain("licensed portal feed");
    expect(coverage.summary).toContain("not a scraper");
  });

  it("has actually built the signals it calls computable", () => {
    // A signal marked computable whose source names a function that does not
    // exist would be the exact 'control with no call site' failure the rest of
    // the platform tests for. These five are the ones with code behind them.
    const built = new Set(["prepared-but-unsold", "bought-and-flipped"]);
    for (const key of built) {
      expect(sourcingSignal(key as never).availability).toBe("computable");
    }
  });

  it("throws on an unknown signal rather than guessing", () => {
    // @ts-expect-error — runtime behaviour on bad input.
    expect(() => sourcingSignal("rent-to-rent")).toThrow(/No sourcing signal/);
  });
});

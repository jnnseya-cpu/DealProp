import { money, ratioBps, sub, type Money } from "@/lib/money";
import { gbp } from "@/lib/format";
import type { PropertyFacts } from "@/domain/types";

/**
 * AI Property GoldMine — mining the market for opportunities others ignore.
 *
 * DATA SOURCING IS A LEGAL CONSTRAINT, NOT A TECHNICAL ONE. The major portals
 * prohibit scraping in their terms, and property data carries licensing and
 * data-protection obligations that vary by jurisdiction. This module therefore
 * consumes a `ListingSignal` interface and takes no position on where the data
 * came from. Connecting a source is a commercial and legal decision that must
 * be made before any adapter is written — see docs/REGULATORY.md.
 *
 * The ethical line this module holds: it looks for owners whose current
 * transaction route is failing them, not for owners who are weak enough to
 * pressure. Signals of *market friction* are scored. Signals of *personal
 * distress* are deliberately excluded from the pressure score, because using
 * them for targeting is what turns deal sourcing into predation.
 */

export interface ListingSignal {
  readonly propertyId: string;
  /** Days the property has been continuously advertised. */
  readonly daysOnMarket: number;
  readonly initialAskingPrice: Money;
  readonly currentAskingPrice: Money;
  readonly priceReductions: number;
  /** Times the listing has been withdrawn and re-listed. */
  readonly relistCount: number;
  /** Number of different agents that have marketed it. */
  readonly agentCount: number;
  readonly previouslyFailedSale: boolean;
  readonly appearsVacant: boolean;
  readonly photoCount: number;
  readonly hasFloorplan: boolean;
  readonly epcRating?: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  /** Median days on market for comparable local stock. */
  readonly localMedianDaysOnMarket: number;
  /** Median asking price for comparable local stock. */
  readonly localMedianAsking: Money;
}

export type HeatCategory = "cold" | "warm" | "hot" | "very-hot" | "goldmine" | "deep-gold";

export function categoriseHeat(signal: ListingSignal): HeatCategory {
  const { daysOnMarket, relistCount, previouslyFailedSale } = signal;
  if (daysOnMarket >= 548 || relistCount >= 2 || (previouslyFailedSale && daysOnMarket >= 365)) {
    return "deep-gold";
  }
  if (daysOnMarket >= 365) return "goldmine";
  if (daysOnMarket >= 274) return "very-hot";
  if (daysOnMarket >= 182) return "hot";
  if (daysOnMarket >= 90) return "warm";
  return "cold";
}

export const HEAT_LABELS: Record<HeatCategory, string> = {
  cold: "Recently listed",
  warm: "Warm — 90 to 180 days",
  hot: "Hot — 6 months or more",
  "very-hot": "Very hot — 9 months or more",
  goldmine: "GoldMine — 12 months or more",
  "deep-gold": "Deep Gold — 18 months, or repeatedly failed",
};

export interface PressureFactor {
  readonly label: string;
  readonly points: number;
  readonly detail: string;
}

export interface SellerPressureResult {
  readonly score: number;
  readonly heat: HeatCategory;
  readonly factors: readonly PressureFactor[];
}

/**
 * Seller Pressure Score.
 *
 * Measures how badly the *current sales route* is failing, not how desperate
 * the person is. Time on market alone is weak evidence — a property listed a
 * year at an unchanged price suggests a seller who will not move. The same
 * property with four reductions and two relistings suggests a seller actively
 * trying and failing, which is a genuine problem the platform can solve.
 */
export function sellerPressure(signal: ListingSignal): SellerPressureResult {
  const factors: PressureFactor[] = [];
  const heat = categoriseHeat(signal);

  const timePoints =
    heat === "deep-gold" ? 25 : heat === "goldmine" ? 22 : heat === "very-hot" ? 18 : heat === "hot" ? 14 : heat === "warm" ? 8 : 0;
  if (timePoints > 0) {
    factors.push({
      label: "Time on market",
      points: timePoints,
      detail: `${signal.daysOnMarket} days advertised against a local median of ${signal.localMedianDaysOnMarket}.`,
    });
  }

  if (signal.priceReductions > 0) {
    const points = Math.min(20, signal.priceReductions * 6);
    factors.push({
      label: "Price reductions",
      points,
      detail: `${signal.priceReductions} reduction(s). The seller is actively trying to transact.`,
    });
  }

  if (signal.relistCount > 0) {
    factors.push({
      label: "Relisted",
      points: Math.min(15, signal.relistCount * 8),
      detail: `Withdrawn and relisted ${signal.relistCount} time(s).`,
    });
  }

  if (signal.agentCount > 1) {
    factors.push({
      label: "Multiple agents",
      points: Math.min(10, (signal.agentCount - 1) * 5),
      detail: `${signal.agentCount} agents have marketed this property.`,
    });
  }

  if (signal.appearsVacant) {
    factors.push({
      label: "Appears vacant",
      points: 15,
      detail: "An empty property carries running costs and no income while it sits unsold.",
    });
  }

  if (signal.previouslyFailedSale) {
    factors.push({
      label: "Sale previously fell through",
      points: 10,
      detail: "A failed transaction means the seller has already lost time and money once.",
    });
  }

  const reductionBps = ratioBps(
    sub(signal.initialAskingPrice, signal.currentAskingPrice),
    signal.initialAskingPrice,
  );
  if (reductionBps >= 1_000) {
    factors.push({
      label: "Substantial cumulative reduction",
      points: 10,
      detail: `Asking price is down ${(reductionBps / 100).toFixed(1)}% from launch.`,
    });
  }

  const score = Math.max(0, Math.min(100, factors.reduce((t, f) => t + f.points, 0)));
  return { score, heat, factors };
}

export interface UnsoldReason {
  readonly cause: string;
  /** Share of the explanation attributed to this cause, 0-100. */
  readonly weight: number;
  readonly detail: string;
}

/**
 * Why has this property not sold?
 *
 * Weights are a transparent heuristic over observable signals, normalised to
 * sum to 100. They are presented as a diagnosis to investigate, not as a
 * finding — the platform cannot know why a specific seller has not sold.
 */
export function diagnoseUnsold(
  signal: ListingSignal,
  property: PropertyFacts,
): readonly UnsoldReason[] {
  const raw: { cause: string; weight: number; detail: string }[] = [];

  // Overpricing against local comparables and against the OS's own valuation.
  const vsLocal = signal.localMedianAsking > 0
    ? (signal.currentAskingPrice - signal.localMedianAsking) / signal.localMedianAsking
    : 0;
  const vsValuation = property.openMarketValue > 0
    ? (signal.currentAskingPrice - property.openMarketValue) / property.openMarketValue
    : 0;
  const overpricing = Math.max(vsLocal, vsValuation);
  if (overpricing > 0.02) {
    raw.push({
      cause: "Overpriced relative to comparable evidence",
      weight: Math.min(50, overpricing * 220),
      detail: `Asking ${gbp(signal.currentAskingPrice)} against an estimated value of ${gbp(property.openMarketValue)}.`,
    });
  }

  const worksShare = property.openMarketValue > 0
    ? property.refurbishmentEstimate / property.openMarketValue
    : 0;
  if (worksShare > 0.05) {
    raw.push({
      cause: "Substantial refurbishment required",
      weight: Math.min(35, worksShare * 130),
      detail: `Estimated works of ${gbp(property.refurbishmentEstimate)} deter buyers needing an ordinary mortgage.`,
    });
  }

  if (signal.photoCount < 8 || !signal.hasFloorplan) {
    raw.push({
      cause: "Weak marketing and presentation",
      weight: 16,
      detail: `${signal.photoCount} photographs${signal.hasFloorplan ? "" : " and no floorplan"}.`,
    });
  }

  if (property.knownIssues.length > 0) {
    const lendingBlockers = property.knownIssues.filter((i) =>
      ["cladding", "japanese-knotweed", "subsidence", "short-lease", "non-standard-construction", "structural"].includes(i),
    );
    if (lendingBlockers.length > 0) {
      raw.push({
        cause: "Mortgage lenders are unlikely to lend",
        weight: 12 + lendingBlockers.length * 8,
        detail: `${lendingBlockers.join(", ")} — this removes most of the buyer pool.`,
      });
    } else {
      raw.push({
        cause: "Known property issues",
        weight: 8,
        detail: property.knownIssues.join(", "),
      });
    }
  }

  if (property.tenure === "leasehold" && (property.leaseYearsRemaining ?? 999) < 80) {
    raw.push({
      cause: "Short lease",
      weight: 18,
      detail: `${property.leaseYearsRemaining} years remaining restricts both lending and resale.`,
    });
  }

  if (signal.localMedianDaysOnMarket > 120) {
    raw.push({
      cause: "Weak local demand",
      weight: 12,
      detail: `Comparable local stock takes a median of ${signal.localMedianDaysOnMarket} days to sell.`,
    });
  }

  if (raw.length === 0) {
    return [
      {
        cause: "No clear cause identified",
        weight: 100,
        detail: "Observable signals do not explain the delay. Worth a direct conversation with the agent.",
      },
    ];
  }

  const total = raw.reduce((t, r) => t + r.weight, 0);
  return raw
    .map((r) => ({ cause: r.cause, weight: Math.round((r.weight / total) * 100), detail: r.detail }))
    .sort((a, b) => b.weight - a.weight);
}

export interface GoldMineResult {
  readonly propertyId: string;
  readonly score: number;
  readonly heat: HeatCategory;
  readonly pressure: SellerPressureResult;
  readonly reasons: readonly UnsoldReason[];
  /** Suggested opening offer and the likely negotiating range. */
  readonly openingOffer: Money;
  readonly negotiationFloor: Money;
  readonly negotiationCeiling: Money;
  readonly recommendation: string;
}

/**
 * GoldMine Score.
 *
 * Combines seller pressure with the spread available between the current
 * asking price and the OS's estimate of value. Pressure without a spread is
 * not an opportunity, and a spread without pressure will not be accepted.
 */
export function scoreGoldMine(
  signal: ListingSignal,
  property: PropertyFacts,
): GoldMineResult {
  const pressure = sellerPressure(signal);
  const reasons = diagnoseUnsold(signal, property);

  // Spread measured against the OS's own valuation, not the asking price,
  // because an inflated asking price would otherwise manufacture a spread.
  const spreadBps = ratioBps(
    sub(property.postWorksValue, signal.currentAskingPrice),
    property.postWorksValue,
  );
  const worksBps = ratioBps(property.refurbishmentEstimate, property.postWorksValue);
  const netSpreadBps = spreadBps - worksBps;

  const spreadScore = Math.max(0, Math.min(100, (netSpreadBps / 100) * 3.5));
  const score = Math.round(pressure.score * 0.45 + spreadScore * 0.55);

  // The opening position sits below the negotiating range on purpose: it is an
  // opening, not an insult, and it is anchored to what the deal can actually
  // bear rather than to a fixed percentage of asking.
  const ceiling = money(Math.round(property.openMarketValue * 0.92));
  const floor = money(Math.round(property.openMarketValue * 0.82));
  const opening = money(Math.round(property.openMarketValue * 0.75));

  let recommendation: string;
  if (score >= 75) {
    recommendation = "Strong candidate. Contact the agent and open a conversation about the seller's actual objective, not just price.";
  } else if (score >= 55) {
    recommendation = "Worth investigating. Confirm the valuation and works estimate before making an approach.";
  } else if (pressure.score >= 60) {
    recommendation = "The seller is under real pressure but the numbers do not yet work. Revisit if the price moves.";
  } else {
    recommendation = "Not a GoldMine opportunity. Neither the pressure signals nor the spread justify the effort.";
  }

  return {
    propertyId: signal.propertyId,
    score,
    heat: pressure.heat,
    pressure,
    reasons,
    openingOffer: opening,
    negotiationFloor: floor,
    negotiationCeiling: ceiling,
    recommendation,
  };
}

export interface DealDensityArea {
  readonly locality: string;
  readonly scanned: number;
  readonly longListed: number;
  readonly strongSignals: number;
  readonly opportunities: number;
  /** 0-100 opportunity density for the area. */
  readonly densityScore: number;
}

/** Deal Density — tells investors where to hunt before what to buy. */
export function dealDensity(
  results: readonly { locality: string; goldmine: GoldMineResult }[],
): readonly DealDensityArea[] {
  const byLocality = new Map<string, GoldMineResult[]>();
  for (const r of results) {
    const list = byLocality.get(r.locality) ?? [];
    list.push(r.goldmine);
    byLocality.set(r.locality, list);
  }

  return [...byLocality.entries()]
    .map(([locality, items]) => {
      const longListed = items.filter((i) => i.heat !== "cold" && i.heat !== "warm").length;
      const strongSignals = items.filter((i) => i.pressure.score >= 55).length;
      const opportunities = items.filter((i) => i.score >= 65).length;
      const densityScore =
        items.length === 0 ? 0 : Math.round((opportunities / items.length) * 60 + (strongSignals / items.length) * 40);
      return {
        locality,
        scanned: items.length,
        longListed,
        strongSignals,
        opportunities,
        densityScore,
      };
    })
    .sort((a, b) => b.densityScore - a.densityScore);
}


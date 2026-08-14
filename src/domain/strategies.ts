import { money, ratioBps, sub, ZERO, type Bps, type Money } from "@/lib/money";
import { appraise, maxViablePrice } from "@/domain/economics";
import { getJurisdiction } from "@/domain/jurisdictions";
import { diagnoseSeller } from "@/domain/motivation";
import type {
  DealAppraisal,
  DealInputs,
  ExitStrategy,
  StructureKind,
} from "@/domain/types";

/**
 * AI Strategy Router.
 *
 * The premise: never force a property into a predetermined strategy. Test every
 * structure and exit the jurisdiction permits, reject the ones that do not
 * work, and explain why each was rejected.
 *
 * The rejections are the product. An investor who is told "assisted sale, 91%
 * fit" learns nothing about their own judgement; an investor who is told
 * "cash purchase rejected — the seller's minimum is above your ceiling, but an
 * assisted sale clears both" has been taught something they can reuse.
 *
 * MODEL FIDELITY: structures that transfer title in the ordinary way are
 * modelled in full. Options, lease options and assisted sales have materially
 * different cash-flow shapes, and modelling them with the purchase engine
 * would produce confident-looking nonsense. They are marked `approximate` and
 * carry an explicit warning rather than being silently mispriced.
 */

const FULL_FIDELITY: ReadonlySet<StructureKind> = new Set<StructureKind>([
  "cash-purchase",
  "bridging-refurb-refinance",
  "private-money-purchase",
  "jv-equity",
  "auction-finance",
  "deferred-consideration",
]);

export type ModelFidelity = "full" | "approximate";

export interface StrategyCandidate {
  readonly structure: StructureKind;
  readonly exit: ExitStrategy;
  readonly label: string;
}

const CANDIDATES: readonly StrategyCandidate[] = [
  { structure: "cash-purchase", exit: "sell", label: "Cash purchase, refurbish and sell" },
  { structure: "cash-purchase", exit: "refinance-and-hold", label: "Cash purchase, refurbish and refinance" },
  { structure: "bridging-refurb-refinance", exit: "refinance-and-hold", label: "Bridge, refurbish, refinance and hold" },
  { structure: "bridging-refurb-refinance", exit: "sell", label: "Bridge, refurbish and flip" },
  { structure: "private-money-purchase", exit: "refinance-and-hold", label: "Private money purchase and refinance" },
  { structure: "jv-equity", exit: "sell", label: "JV equity partnership, sell on completion" },
  { structure: "jv-equity", exit: "refinance-and-hold", label: "JV equity partnership, refinance and hold" },
  { structure: "deferred-consideration", exit: "sell", label: "Deferred consideration purchase" },
  { structure: "seller-finance", exit: "refinance-and-hold", label: "Seller-financed acquisition" },
  { structure: "option-agreement", exit: "assign", label: "Option agreement, assign the contract" },
  { structure: "lease-option", exit: "rent-only", label: "Lease option, operate for income" },
  { structure: "assisted-sale", exit: "sell", label: "Assisted sale — improve, then sell for the seller" },
  { structure: "auction-finance", exit: "sell", label: "Auction purchase and resale" },
  { structure: "cash-purchase", exit: "rent-only", label: "Cash purchase, hold and rent" },
];

export type StrategyStatus = "viable" | "marginal" | "rejected" | "not-permitted" | "needs-review";

export interface StrategyResult {
  readonly candidate: StrategyCandidate;
  readonly status: StrategyStatus;
  /** 0-100 fit against this seller, property and jurisdiction. */
  readonly fit: number;
  readonly appraisal?: DealAppraisal;
  readonly fidelity: ModelFidelity;
  /** Why this strategy was recommended or rejected. */
  readonly reason: string;
  readonly requires: readonly string[];
}

export interface StrategyRouterReport {
  readonly tested: number;
  readonly viable: readonly StrategyResult[];
  readonly needsReview: readonly StrategyResult[];
  readonly rejected: readonly StrategyResult[];
  readonly best?: StrategyResult;
  readonly summary: string;
}

export function routeStrategies(inputs: DealInputs): StrategyRouterReport {
  const pack = getJurisdiction(inputs.property.jurisdiction);
  const diagnostics = diagnoseSeller(inputs.seller, inputs.property);

  const results = CANDIDATES.map<StrategyResult>((candidate) => {
    const ruling = pack.structureStatus(candidate.structure);
    const fidelity: ModelFidelity = FULL_FIDELITY.has(candidate.structure) ? "full" : "approximate";

    if (ruling.permission === "not-supported") {
      return {
        candidate,
        status: "not-permitted",
        fit: 0,
        fidelity,
        reason: `Not available in ${pack.name}. ${ruling.note}`,
        requires: ruling.requires,
      };
    }

    const trial: DealInputs = { ...inputs, structure: candidate.structure, exit: candidate.exit };
    const appraisal = appraise(trial);

    let fit = 50;
    const notes: string[] = [];

    // --- Economics ------------------------------------------------------
    const marginPct = appraisal.marginOnGdvBps / 100;
    if (appraisal.profit <= 0) {
      return {
        candidate,
        status: "rejected",
        fit: 0,
        appraisal,
        fidelity,
        reason: `Loses money after tax at this price (${fmt(appraisal.profit)}). ${describeCeiling(trial)}`,
        requires: ruling.requires,
      };
    }
    fit += Math.min(30, marginPct * 1.6);
    notes.push(`${marginPct.toFixed(1)}% margin after tax`);

    // --- Seller fit -----------------------------------------------------
    // A seller who wants speed will not accept a structure that pays them
    // slowly, however good the economics look for the buyer.
    const slowStructures: ReadonlySet<StructureKind> = new Set([
      "seller-finance",
      "deferred-consideration",
      "option-agreement",
      "lease-option",
      "assisted-sale",
    ]);
    const wantsSpeed = inputs.seller.priorities.includes("speed");
    const wantsPrice = inputs.seller.priorities.includes("price");

    if (slowStructures.has(candidate.structure)) {
      if (wantsSpeed) {
        fit -= 30;
        notes.push("seller wants speed but this structure pays them over time");
      }
      if (wantsPrice) {
        // Creative structures usually beat a cash offer on headline price,
        // because the buyer is paying for time rather than for discount.
        fit += 18;
        notes.push("achieves a higher headline price than a cash offer");
      }
      if (diagnostics.priorityFlexibility >= 60) {
        fit += 12;
        notes.push("seller is flexible on terms");
      }
    } else {
      if (wantsSpeed) {
        fit += 15;
        notes.push("completes quickly");
      }
      if (wantsPrice && appraisal.discountToOmvBps > 1_500) {
        fit -= 20;
        notes.push("requires a discount the seller may refuse");
      }
    }

    // Assisted sale specifically solves the case where the seller's minimum
    // exceeds what any investor can pay to own the asset.
    if (candidate.structure === "assisted-sale" && inputs.seller.priceExpectation !== undefined) {
      const ceiling = maxViablePrice({ ...trial, structure: "cash-purchase" }, 1_500);
      if (inputs.seller.priceExpectation > ceiling) {
        fit += 25;
        notes.push("seller's minimum exceeds any cash purchase ceiling, which is exactly what this structure solves");
      }
    }

    // --- Capital -------------------------------------------------------
    const equityShare = ratioBps(appraisal.funding.equityRequired, appraisal.funding.totalRequired) / 100;
    if (equityShare > 45) {
      fit -= 12;
      notes.push(`${equityShare.toFixed(0)}% equity required`);
    }

    // --- Exit fit ------------------------------------------------------
    if (candidate.exit === "refinance-and-hold") {
      const recycle = capitalRecycle(appraisal);
      fit += recycle.score / 8;
      notes.push(`recycles ${(recycle.recycledBps / 100).toFixed(0)}% of capital`);
    }
    if (candidate.exit === "rent-only" && inputs.property.monthlyRent <= 0) {
      return {
        candidate,
        status: "rejected",
        fit: 0,
        appraisal,
        fidelity,
        reason: "No rental income recorded for this property, so an income strategy cannot be assessed.",
        requires: ruling.requires,
      };
    }

    fit = Math.max(0, Math.min(100, Math.round(fit)));

    const needsReview =
      ruling.permission === "regulated" || fidelity === "approximate";

    const fidelityNote =
      fidelity === "approximate"
        ? " Cash flows for this structure differ from an ordinary purchase and are approximated — treat the figures as indicative only."
        : "";

    const status: StrategyStatus =
      fit < 35 ? "rejected" : needsReview ? "needs-review" : fit >= 60 ? "viable" : "marginal";

    return {
      candidate,
      status,
      fit,
      appraisal,
      fidelity,
      reason: `${notes.join("; ")}.${fidelityNote}`,
      requires: ruling.requires,
    };
  });

  const sorted = [...results].sort((a, b) => b.fit - a.fit);
  const viable = sorted.filter((r) => r.status === "viable" || r.status === "marginal");
  const needsReview = sorted.filter((r) => r.status === "needs-review");
  const rejected = sorted.filter((r) => r.status === "rejected" || r.status === "not-permitted");

  const best = sorted.find((r) => r.status === "viable") ?? sorted.find((r) => r.status === "needs-review") ?? viable[0];

  return {
    tested: results.length,
    viable,
    needsReview,
    rejected,
    best,
    summary: `${results.length} strategies tested. ${rejected.length} rejected, ${needsReview.length} require professional review, ${viable.length} viable.`,
  };
}

// ---------------------------------------------------------------------------
// Capital recycling — "no money left in"
// ---------------------------------------------------------------------------

export interface CapitalRecycleResult {
  readonly deployed: Money;
  readonly released: Money;
  readonly leftIn: Money;
  /** Share of deployed capital returned on refinance, basis points. */
  readonly recycledBps: Bps;
  /** 0-100. */
  readonly score: number;
  readonly verdict: string;
}

/**
 * How much of the investor's own capital comes back out on refinance.
 *
 * This is the number that determines how fast a portfolio can scale, and it is
 * a different question from ROI. A deal can have an excellent ROI and still
 * trap capital for years.
 */
export function capitalRecycle(appraisal: DealAppraisal): CapitalRecycleResult {
  const deployed = appraisal.funding.equityRequired;
  const advance = appraisal.exit.refinanceAdvance ?? ZERO;
  const seniorDebt = appraisal.funding.seniorDebt;

  // The refinance first repays the senior facility; only the surplus can
  // return the investor's own money.
  const released = money(Math.max(0, Math.min(advance - seniorDebt, deployed)));
  const leftIn = sub(deployed, released);
  const recycledBps = ratioBps(released, deployed);

  const score = Math.max(0, Math.min(100, Math.round(recycledBps / 100)));

  let verdict: string;
  if (appraisal.exit.refinanceAdvance === undefined) {
    verdict = "This exit does not involve a refinance, so no capital is recycled at exit.";
  } else if (recycledBps >= 9_800) {
    verdict = "Effectively all capital is returned on refinance. The investor can move straight to the next deal.";
  } else if (recycledBps >= 7_500) {
    verdict = `${(recycledBps / 100).toFixed(0)}% of capital is returned. A modest amount stays in the deal.`;
  } else if (recycledBps >= 4_000) {
    verdict = `Only ${(recycledBps / 100).toFixed(0)}% comes back. ${fmt(leftIn)} stays trapped in this property.`;
  } else {
    verdict = `Capital does not recycle. ${fmt(leftIn)} is committed for the life of the hold.`;
  }

  return { deployed, released, leftIn, recycledBps, score, verdict };
}

// ---------------------------------------------------------------------------
// Exit matrix — never depend on one way out
// ---------------------------------------------------------------------------

export interface ExitOption {
  readonly strategy: ExitStrategy;
  readonly label: string;
  readonly profit: Money;
  readonly viable: boolean;
}

export interface ExitMatrix {
  readonly options: readonly ExitOption[];
  readonly viableCount: number;
  /** 0-100. How many independent ways out this deal has. */
  readonly resilience: number;
  readonly primary?: ExitOption;
  readonly fallback?: ExitOption;
  readonly fragile: boolean;
  readonly summary: string;
}

const EXIT_LABELS: Record<ExitStrategy, string> = {
  sell: "Refurbish and sell",
  "refinance-and-hold": "Refinance and hold",
  "rent-only": "Hold and rent",
  assign: "Assign the contract",
};

/**
 * A deal with exactly one way out is a bet, not an investment. This runs every
 * exit against the same purchase and reports how many independently work.
 */
export function buildExitMatrix(inputs: DealInputs): ExitMatrix {
  const strategies: ExitStrategy[] = ["sell", "refinance-and-hold", "rent-only", "assign"];

  const options = strategies.map<ExitOption>((strategy) => {
    const appraisal = appraise({ ...inputs, exit: strategy });
    return {
      strategy,
      label: EXIT_LABELS[strategy],
      profit: appraisal.profit,
      viable: appraisal.profit > 0,
    };
  });

  const viableOptions = options.filter((o) => o.viable).sort((a, b) => b.profit - a.profit);
  const viableCount = viableOptions.length;
  const resilience = Math.round((viableCount / strategies.length) * 100);
  const fragile = viableCount <= 1;

  return {
    options,
    viableCount,
    resilience,
    primary: viableOptions[0],
    fallback: viableOptions[1],
    fragile,
    summary: fragile
      ? `FRAGILE: only ${viableCount} of ${strategies.length} exits produce a profit. If that route closes, there is no way out.`
      : `${viableCount} of ${strategies.length} exits produce a profit after tax.`,
  };
}

function describeCeiling(inputs: DealInputs): string {
  const ceiling = maxViablePrice(inputs, 1_500);
  return ceiling > 0
    ? `Maximum price for a 15% margin is ${fmt(ceiling)}.`
    : "No purchase price produces an acceptable margin.";
}

function fmt(value: Money): string {
  const major = Math.round(value / 100);
  return `${major < 0 ? "-" : ""}£${Math.abs(major).toLocaleString("en-GB")}`;
}

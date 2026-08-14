import { pct, ratioBps, type Bps } from "@/lib/money";
import { getJurisdiction } from "@/domain/jurisdictions";
import { diagnoseSeller } from "@/domain/motivation";
import { runRedTeam, type RedTeamReport } from "@/domain/redteam";
import { assessSellerProtection, type ProtectionOutcome } from "@/domain/protection";
import type { DealAppraisal, DealInputs, ScoreBreakdown, ScoreComponent, Verdict } from "@/domain/types";
import { appraise } from "@/domain/economics";

/**
 * Deal Score.
 *
 * The score is a weighted composite of nine independently defensible
 * components. Two properties matter more than the exact weights:
 *
 *  1. Every component carries a rationale string. A score a lender cannot
 *     interrogate is worth nothing to them.
 *  2. The score cannot rescue a deal that fails a hard gate. Protection blocks
 *     and capital-loss scenarios cap the composite regardless of how strong
 *     the margin looks, because those are the cases where a high score would
 *     do the most damage.
 */

interface Weighted {
  readonly key: string;
  readonly label: string;
  readonly weightBps: Bps;
}

const WEIGHTS: readonly Weighted[] = [
  { key: "margin", label: "Margin quality", weightBps: pct(18) },
  { key: "priceAdvantage", label: "Price advantage", weightBps: pct(12) },
  { key: "motivation", label: "Seller motivation", weightBps: pct(10) },
  { key: "financeability", label: "Financeability", weightBps: pct(12) },
  { key: "resilience", label: "Stress resilience", weightBps: pct(14) },
  { key: "exitLiquidity", label: "Exit liquidity", weightBps: pct(10) },
  { key: "rentalStrength", label: "Rental strength", weightBps: pct(8) },
  { key: "refurbRisk", label: "Refurbishment risk", weightBps: pct(8) },
  { key: "legalComplexity", label: "Legal complexity", weightBps: pct(8) },
];

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** Map a value across a range onto 0-100, saturating at both ends. */
function band(value: number, worst: number, best: number): number {
  if (best === worst) return 50;
  return clamp(((value - worst) / (best - worst)) * 100);
}

export interface DealScoreResult {
  readonly breakdown: ScoreBreakdown;
  readonly verdict: Verdict;
  readonly verdictReason: string;
  readonly appraisal: DealAppraisal;
  readonly redTeam: RedTeamReport;
  readonly protection: ProtectionOutcome;
}

export function scoreDeal(inputs: DealInputs): DealScoreResult {
  const appraisal = appraise(inputs);
  const redTeam = runRedTeam(inputs);
  const diagnostics = diagnoseSeller(inputs.seller, inputs.property);
  const protection = assessSellerProtection(inputs, diagnostics);
  const pack = getJurisdiction(inputs.property.jurisdiction);
  const property = inputs.property;

  const components: ScoreComponent[] = [];
  const push = (key: string, score: number, rationale: string): void => {
    const w = WEIGHTS.find((x) => x.key === key);
    if (w === undefined) throw new Error(`Unknown score component ${key}`);
    components.push({ key, label: w.label, score: clamp(score), weightBps: w.weightBps, rationale });
  };

  // --- Margin: 0% is worthless, 30% on GDV is excellent ------------------
  const marginPct = appraisal.marginOnGdvBps / 100;
  push(
    "margin",
    band(marginPct, 0, 30),
    `Projected profit of ${marginPct.toFixed(1)}% on gross development value.`,
  );

  // --- Price advantage against open market value ------------------------
  const discountPct = appraisal.discountToOmvBps / 100;
  push(
    "priceAdvantage",
    band(discountPct, -5, 30),
    discountPct >= 0
      ? `Purchase price is ${discountPct.toFixed(1)}% below estimated open market value.`
      : `Purchase price is ${Math.abs(discountPct).toFixed(1)}% ABOVE estimated open market value.`,
  );

  // --- Motivation --------------------------------------------------------
  push(
    "motivation",
    diagnostics.motivation,
    `${diagnostics.situationLabel}. Urgency ${diagnostics.urgency}/100, flexibility on terms ${diagnostics.priorityFlexibility}/100.`,
  );

  // --- Financeability: how much equity must be found, and is it lendable --
  const equityShareBps = ratioBps(appraisal.funding.equityRequired, appraisal.funding.totalRequired);
  const equitySharePct = equityShareBps / 100;
  let financeability = band(equitySharePct, 60, 20);
  const ruling = pack.structureStatus(inputs.structure);
  if (ruling.permission === "not-supported") financeability = 0;
  else if (ruling.permission === "regulated") financeability -= 10;
  push(
    "financeability",
    financeability,
    `${equitySharePct.toFixed(1)}% of total requirement must be found as equity. Structure is ${ruling.permission.replace(/-/g, " ")} in ${pack.name}.`,
  );

  // --- Resilience straight from the Red Team -----------------------------
  push("resilience", redTeam.resilience, redTeam.summary);

  // --- Exit liquidity ----------------------------------------------------
  let liquidity = 60;
  if (property.propertyType === "house" || property.propertyType === "bungalow") liquidity += 20;
  if (property.propertyType === "flat") liquidity -= 5;
  if (property.propertyType === "commercial" || property.propertyType === "land") liquidity -= 25;
  if (property.propertyType === "hmo") liquidity -= 10;
  if (property.tenure === "leasehold") liquidity -= 10;
  if ((property.leaseYearsRemaining ?? 999) < 80) liquidity -= 20;
  if (property.valuationConfidence < 7_000) liquidity -= 15;
  if (inputs.exit === "assign") liquidity -= 20;
  push(
    "exitLiquidity",
    liquidity,
    `${property.propertyType} in ${property.locality}, ${property.tenure}. Valuation confidence ${(property.valuationConfidence / 100).toFixed(0)}%.`,
  );

  // --- Rental strength: yield on total cost ------------------------------
  const annualRent = property.monthlyRent * 12;
  const yieldBps = appraisal.costs.total > 0
    ? Math.round((annualRent / appraisal.costs.total) * 10_000)
    : 0;
  const yieldPct = yieldBps / 100;
  push(
    "rentalStrength",
    band(yieldPct, 3, 10),
    `Gross yield of ${yieldPct.toFixed(1)}% on total capital deployed.`,
  );

  // --- Refurbishment risk: works as a share of value ---------------------
  const worksShare = property.openMarketValue > 0
    ? (property.refurbishmentEstimate / property.openMarketValue) * 100
    : 0;
  let refurbScore = band(worksShare, 45, 0);
  const structuralIssues = property.knownIssues.filter((i) =>
    ["structural", "subsidence", "japanese-knotweed", "cladding", "non-standard-construction"].includes(i),
  );
  refurbScore -= structuralIssues.length * 15;
  push(
    "refurbRisk",
    refurbScore,
    `Works represent ${worksShare.toFixed(1)}% of market value${structuralIssues.length > 0 ? `; ${structuralIssues.length} structural risk factor(s): ${structuralIssues.join(", ")}` : "; no structural risk factors recorded"}.`,
  );

  // --- Legal complexity --------------------------------------------------
  let legal = 90;
  legal -= diagnostics.complexity * 0.35;
  const titleIssues = property.knownIssues.filter((i) =>
    ["title-defect", "unregistered-title", "restrictive-covenant", "short-lease", "no-building-regs"].includes(i),
  );
  legal -= titleIssues.length * 12;
  if (ruling.permission === "regulated") legal -= 15;
  if (ruling.permission === "permitted-with-professional") legal -= 5;
  if (ruling.permission === "not-supported") legal = 0;
  push(
    "legalComplexity",
    legal,
    titleIssues.length > 0
      ? `${titleIssues.length} title or compliance issue(s): ${titleIssues.join(", ")}.`
      : `No title issues recorded. ${ruling.note}`,
  );

  // --- Composite ---------------------------------------------------------
  let composite = Math.round(
    components.reduce((total, c) => total + (c.score * c.weightBps) / 10_000, 0),
  );

  // Hard gates. These exist because a high composite on a deal that is
  // blocked or can lose capital is not a scoring inaccuracy, it is a hazard.
  const gates: string[] = [];
  if (protection.blocked) {
    composite = Math.min(composite, 35);
    gates.push("seller protection block");
  }
  // Only a single-factor loss caps the composite. A deal that survives every
  // one-variable shock and only fails the compound tail is ordinary, and
  // capping it here would compress the whole population into one band.
  if (redTeam.singleFactorLosses.length > 0) {
    composite = Math.min(composite, 62);
    gates.push("capital loss when a single variable moves");
  }
  if (ruling.permission === "not-supported") {
    composite = Math.min(composite, 20);
    gates.push("structure not supported in this jurisdiction");
  }
  if (appraisal.profit <= 0) {
    composite = Math.min(composite, 25);
    gates.push("no profit in the base case");
  }

  const { verdict, reason } = decideVerdict({
    composite,
    appraisal,
    redTeam,
    protection,
    permission: ruling.permission,
    gates,
  });

  return {
    breakdown: { composite: clamp(composite), components },
    verdict,
    verdictReason: reason,
    appraisal,
    redTeam,
    protection,
  };
}

function decideVerdict(args: {
  composite: number;
  appraisal: DealAppraisal;
  redTeam: RedTeamReport;
  protection: ProtectionOutcome;
  permission: string;
  gates: readonly string[];
}): { verdict: Verdict; reason: string } {
  const { composite, appraisal, redTeam, protection, permission, gates } = args;

  if (protection.blocked) {
    return {
      verdict: "reject",
      reason:
        "Blocked by the Seller Protection Engine. This deal cannot be shown to capital until the flagged safeguards are evidenced and a human reviewer has signed off.",
    };
  }

  if (permission === "not-supported") {
    return {
      verdict: "reject",
      reason: "This structure cannot lawfully be offered in this jurisdiction.",
    };
  }

  if (appraisal.profit <= 0) {
    return {
      verdict: "negotiate",
      reason:
        "The base case does not produce a profit. The price is the problem, not the structure — see the maximum viable price before re-approaching the seller.",
    };
  }

  if (redTeam.singleFactorLosses.length >= 2) {
    return {
      verdict: "restructure",
      reason: `Capital is lost when any of ${redTeam.singleFactorLosses.length} single variables move. The deal needs less leverage, a lower price or a longer funding runway before it is safe to fund.`,
    };
  }

  if (composite >= 78 && redTeam.singleFactorLosses.length === 0) {
    return {
      verdict: "proceed",
      reason: "Strong economics that survive every stress scenario. Ready to present to matched capital.",
    };
  }

  if (composite >= 60) {
    return {
      verdict: "negotiate",
      reason: `Viable but not yet compelling${gates.length > 0 ? ` (${gates.join("; ")})` : ""}. Improve the entry price or the finance terms before committing.`,
    };
  }

  if (composite >= 45) {
    return {
      verdict: "restructure",
      reason: "The deal does not work in its current shape. Try a different structure, exit or leverage level.",
    };
  }

  return {
    verdict: "reject",
    reason: "The economics do not justify the risk at any sensible price. Walk away.",
  };
}

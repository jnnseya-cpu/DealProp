import { buildCapitalStack, DEFAULT_PREFERENCES, type CapitalStack, type StackPreferences } from "@/domain/capitalStack";
import { scoreDeal, type DealScoreResult } from "@/domain/dealScore";
import { getJurisdiction, isDealReady } from "@/domain/jurisdictions";
import { diagnoseSeller, type SellerDiagnostics } from "@/domain/motivation";
import { buildExitMatrix, capitalRecycle, routeStrategies, type CapitalRecycleResult, type ExitMatrix, type StrategyRouterReport } from "@/domain/strategies";
import { maxViablePrice } from "@/domain/economics";
import type { DealInputs, Verdict } from "@/domain/types";
import type { RegulatoryObligation } from "@/domain/jurisdictions/types";

/**
 * AI Deal Director.
 *
 * The single entry point that runs every agent over one deal and returns one
 * coherent position. Nothing in the UI computes its own economics; it all
 * comes from here, so the memorandum, the score and the seller-facing options
 * can never disagree with one another.
 *
 * Order matters. Protection and jurisdiction run before anything is presented,
 * because a deal that must not be shown should not be scored, matched or
 * packaged first.
 */

export interface DirectorBriefing {
  readonly inputs: DealInputs;
  readonly diagnostics: SellerDiagnostics;
  readonly scored: DealScoreResult;
  readonly strategies: StrategyRouterReport;
  readonly exits: ExitMatrix;
  readonly recycle: CapitalRecycleResult;
  readonly stack: CapitalStack;
  readonly verdict: Verdict;
  readonly headline: string;
  readonly reasons: readonly string[];
  /** Actions required before this deal may be shown to capital. */
  readonly gatingActions: readonly string[];
  readonly obligations: readonly RegulatoryObligation[];
  /** Price at which the deal clears a 15% margin, for renegotiation. */
  readonly maxViablePrice: ReturnType<typeof maxViablePrice>;
  readonly jurisdictionReady: boolean;
}

export function runDealDirector(
  inputs: DealInputs,
  stackPrefs: StackPreferences = DEFAULT_PREFERENCES,
): DirectorBriefing {
  const pack = getJurisdiction(inputs.property.jurisdiction);
  const jurisdictionReady = isDealReady(inputs.property.jurisdiction);

  const diagnostics = diagnoseSeller(inputs.seller, inputs.property);
  const scored = scoreDeal(inputs);
  const strategies = routeStrategies(inputs);
  const exits = buildExitMatrix(inputs);
  const recycle = capitalRecycle(scored.appraisal);
  const stack = buildCapitalStack(scored.appraisal, stackPrefs);

  const reasons: string[] = [scored.verdictReason];
  const gating: string[] = [];

  if (!jurisdictionReady) {
    gating.push(
      `${pack.name} is not marked deal-ready. Its rate tables have not been verified and must not be relied on for a live transaction.`,
    );
  }

  if (scored.protection.blocked) {
    for (const flag of scored.protection.flags.filter((f) => f.severity === "block")) {
      gating.push(`${flag.label} — ${flag.remedy}`);
    }
  } else if (scored.protection.requiresHumanReview) {
    gating.push("Multiple caution flags raised. A human reviewer must sign off before this reaches capital.");
  }

  if (!stack.feasible) {
    reasons.push(
      stack.shortfall > 0
        ? "The capital stack does not close: there is a funding shortfall on these assumptions."
        : "The capital stack closes but leaves nothing for the originator.",
    );
  }

  if (exits.fragile) {
    reasons.push(exits.summary);
  }

  if (strategies.best !== undefined && strategies.best.candidate.structure !== inputs.structure) {
    reasons.push(
      `The Strategy Router ranks "${strategies.best.candidate.label}" above the structure currently modelled.`,
    );
  }

  // Everything below the appraisal is an estimate that a professional must
  // confirm. Saying so once, prominently, is more honest than a footnote.
  gating.push(
    `${scored.appraisal.profitTaxLabel} is an estimate for screening only and must be confirmed by a qualified tax adviser before exchange.`,
  );

  const headline = buildHeadline(scored, stack, exits);

  return {
    inputs,
    diagnostics,
    scored,
    strategies,
    exits,
    recycle,
    stack,
    verdict: scored.verdict,
    headline,
    reasons,
    gatingActions: gating,
    obligations: pack.obligations,
    maxViablePrice: maxViablePrice(inputs, 1_500),
    jurisdictionReady,
  };
}

function buildHeadline(
  scored: DealScoreResult,
  stack: CapitalStack,
  exits: ExitMatrix,
): string {
  const score = scored.breakdown.composite;
  const profit = Math.round(scored.appraisal.profit / 100);

  switch (scored.verdict) {
    case "proceed":
      return `Deal Score ${score}/100. £${profit.toLocaleString("en-GB")} projected after tax, with ${exits.viableCount} viable exits and a capital stack that closes.`;
    case "negotiate":
      return `Deal Score ${score}/100. Workable, but the entry price is doing too much of the work — negotiate before committing.`;
    case "restructure":
      return `Deal Score ${score}/100. The economics exist but this shape does not hold${stack.feasible ? "" : " and the capital stack does not close"}. Try a different structure or exit.`;
    case "reject":
      return `Deal Score ${score}/100. This deal should not proceed.`;
  }
}

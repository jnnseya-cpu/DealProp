/**
 * Trend Intelligence — experiments and native measurement (spec §10, §18).
 *
 * The loop only closes if the change is measured and the evidence, not a hope,
 * decides whether it stays. This module is the deterministic measurement: it
 * freezes an experiment plan at brief approval, then reads first-party outcomes
 * against it and returns one of four recommendations — continue, revise,
 * rollback, inconclusive — with the reasons.
 *
 * It encodes the §10 discipline that stops a team fooling itself:
 *
 *  - **Freeze before you look.** The hypothesis, baseline, primary outcome,
 *    segment, control method, the minimum detectable effect (or an observation
 *    target), the window and the guardrails are fixed at approval. You cannot
 *    move the goalposts after seeing the result.
 *  - **A guardrail breach or a live incident stops it, now.** A policy incident
 *    or stock running out forces rollback immediately, whatever the headline
 *    metric says; a breached guardrail (refunds, cancellations, unsubscribes
 *    rising past its limit) forces rollback too.
 *  - **Do not promote on noise.** A positive result is only credible when the
 *    sample is mature AND the relative lift clears the pre-registered minimum
 *    detectable effect. Below that it is revise, not scale.
 *  - **Correlation is not lift.** Without a randomised assignment or holdout the
 *    result is marked observational, never reported as estimated incremental
 *    lift. A site-wide confound or inadequate data at the window's end is
 *    inconclusive, recorded as such rather than forced into a decision.
 *
 * Native measurement only: eligible visits and CTA completions counted
 * first-party, no external analytics tag (spec §18). Pure and deterministic —
 * no model, no provider.
 */

export const TREND_EXPERIMENT_VERSION = "trend-experiment-1";

export type ControlMethod = "randomised" | "holdout" | "matched_control" | "observational";

/** A metric that must stay within a bound or the experiment stops (spec §10). */
export interface Guardrail {
  readonly metric: string;
  /** "max": breach when value exceeds threshold; "min": breach when below it. */
  readonly direction: "max" | "min";
  readonly threshold: number;
}

/** Everything frozen at brief approval (spec §10.1). Immutable thereafter. */
export interface ExperimentPlan {
  readonly experimentId: string;
  readonly hypothesis: string;
  /** Baseline outcome rate (0–1) for the primary outcome. */
  readonly baselineRate: number;
  readonly primaryOutcome: string;
  readonly denominator: string;
  readonly segment: string;
  readonly controlMethod: ControlMethod;
  /** Pre-registered minimum detectable effect, as a relative fraction (e.g. 0.1). */
  readonly minDetectableEffect: number;
  /** Minimum eligible denominator before the result is mature. */
  readonly observationTarget: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly guardrails: readonly Guardrail[];
  readonly owner: string;
}

export interface FreezeParams {
  readonly experimentId: string;
  readonly hypothesis: string;
  readonly baselineRate: number;
  readonly primaryOutcome: string;
  readonly denominator: string;
  readonly segment: string;
  readonly controlMethod: ControlMethod;
  readonly minDetectableEffect: number;
  readonly observationTarget: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly guardrails?: readonly Guardrail[];
  readonly owner: string;
}

export type FreezeResult =
  | { readonly ok: true; readonly plan: ExperimentPlan }
  | { readonly ok: false; readonly reason: string };

/** Freeze an experiment plan at approval. Validates the window and the owner. */
export function freezeExperiment(params: FreezeParams): FreezeResult {
  if (params.owner.trim() === "") return { ok: false, reason: "a responsible owner is required" };
  if (params.primaryOutcome.trim() === "") return { ok: false, reason: "a primary outcome is required" };
  const start = Date.parse(params.windowStart);
  const end = Date.parse(params.windowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return { ok: false, reason: "windowStart must be before windowEnd" };
  }
  if (params.observationTarget <= 0) return { ok: false, reason: "observationTarget must be positive" };
  if (params.minDetectableEffect <= 0) return { ok: false, reason: "minDetectableEffect must be positive" };
  if (params.baselineRate < 0 || params.baselineRate > 1) {
    return { ok: false, reason: "baselineRate must be between 0 and 1" };
  }
  return {
    ok: true,
    plan: {
      experimentId: params.experimentId,
      hypothesis: params.hypothesis,
      baselineRate: params.baselineRate,
      primaryOutcome: params.primaryOutcome,
      denominator: params.denominator,
      segment: params.segment,
      controlMethod: params.controlMethod,
      minDetectableEffect: params.minDetectableEffect,
      observationTarget: params.observationTarget,
      windowStart: params.windowStart,
      windowEnd: params.windowEnd,
      guardrails: params.guardrails ?? [],
      owner: params.owner,
    },
  };
}

/** First-party native outcomes read against a plan (spec §18 native measurement). */
export interface ExperimentResults {
  /** Eligible sessions/visits exposed to the treatment (the denominator). */
  readonly treatmentEligible: number;
  readonly treatmentOutcomes: number;
  /** Control eligible/outcomes when a holdout or matched control exists. */
  readonly controlEligible?: number;
  readonly controlOutcomes?: number;
  /** Observed guardrail metric values (metric → value). */
  readonly guardrailValues?: Readonly<Record<string, number>>;
  /** A live policy incident — forces an immediate stop (spec §10.3). */
  readonly policyIncident?: boolean;
  /** Stock/offer became unavailable — forces an immediate stop (spec §10.3). */
  readonly stockUnavailable?: boolean;
  /** A site-wide confound makes the comparison untrustworthy (spec §10.2). */
  readonly confounded?: boolean;
  /** Whether the window has closed (mature observational read only after it). */
  readonly windowClosed?: boolean;
}

export type ExperimentRecommendation = "continue" | "revise" | "rollback" | "inconclusive";

export interface LiftEstimate {
  readonly treatmentRate: number;
  readonly controlRate?: number;
  readonly absolute: number;
  readonly relative: number;
  /** True when there is no randomised/holdout control: correlation, not lift. */
  readonly observational: boolean;
}

export interface ExperimentEvaluation {
  readonly recommendation: ExperimentRecommendation;
  readonly mature: boolean;
  readonly lift?: LiftEstimate;
  readonly guardrailBreaches: readonly string[];
  readonly reasons: readonly string[];
  readonly version: string;
}

function guardrailBreaches(plan: ExperimentPlan, values: Readonly<Record<string, number>>): string[] {
  const breaches: string[] = [];
  for (const g of plan.guardrails) {
    const v = values[g.metric];
    if (v === undefined) continue;
    if (g.direction === "max" && v > g.threshold) breaches.push(`${g.metric} ${v} > ${g.threshold}`);
    if (g.direction === "min" && v < g.threshold) breaches.push(`${g.metric} ${v} < ${g.threshold}`);
  }
  return breaches;
}

/**
 * Evaluate results against the frozen plan. The precedence is deliberate: a live
 * incident or stock-out stops it before any metric is read; a guardrail breach
 * stops it next; a confound or inadequate data is inconclusive; only then is the
 * credible-positive test applied — mature AND relative lift at or above the
 * pre-registered MDE — distinguishing a real improvement from noise.
 */
export function evaluateExperiment(plan: ExperimentPlan, results: ExperimentResults): ExperimentEvaluation {
  const reasons: string[] = [];

  // 1. Hard stops, before any headline metric (spec §10.3).
  if (results.policyIncident === true) {
    return { recommendation: "rollback", mature: false, guardrailBreaches: [], reasons: ["policy incident — stop immediately"], version: TREND_EXPERIMENT_VERSION };
  }
  if (results.stockUnavailable === true) {
    return { recommendation: "rollback", mature: false, guardrailBreaches: [], reasons: ["stock/offer unavailable — stop immediately"], version: TREND_EXPERIMENT_VERSION };
  }

  // 2. Guardrails (spec §10.3).
  const breaches = guardrailBreaches(plan, results.guardrailValues ?? {});
  if (breaches.length > 0) {
    return { recommendation: "rollback", mature: false, guardrailBreaches: breaches, reasons: [`guardrail breached: ${breaches.join("; ")}`], version: TREND_EXPERIMENT_VERSION };
  }

  // 3. Can we even read a rate?
  if (results.treatmentEligible <= 0) {
    return { recommendation: "continue", mature: false, guardrailBreaches: [], reasons: ["no eligible sessions yet — keep gathering"], version: TREND_EXPERIMENT_VERSION };
  }

  const treatmentRate = results.treatmentOutcomes / results.treatmentEligible;
  const hasControl =
    results.controlEligible !== undefined &&
    results.controlEligible > 0 &&
    results.controlOutcomes !== undefined;
  const controlRate = hasControl ? (results.controlOutcomes as number) / (results.controlEligible as number) : plan.baselineRate;
  const observational = !(plan.controlMethod === "randomised" || plan.controlMethod === "holdout") || !hasControl;

  const absolute = treatmentRate - controlRate;
  const relative = controlRate > 0 ? absolute / controlRate : 0;
  const lift: LiftEstimate = {
    treatmentRate,
    ...(hasControl ? { controlRate } : {}),
    absolute,
    relative,
    observational,
  };

  // 4. Confound → inconclusive (spec §10.2).
  if (results.confounded === true) {
    return { recommendation: "inconclusive", mature: false, lift, guardrailBreaches: [], reasons: ["site-wide confound — comparison untrustworthy"], version: TREND_EXPERIMENT_VERSION };
  }

  // 5. Maturity: enough data?
  const mature = results.treatmentEligible >= plan.observationTarget;
  if (!mature) {
    return { recommendation: "continue", mature: false, lift, guardrailBreaches: [], reasons: [`sample ${results.treatmentEligible} below observation target ${plan.observationTarget} — keep gathering, do not promote on noise`], version: TREND_EXPERIMENT_VERSION };
  }

  // 6. Mature: apply the credible-positive test (spec §10.3).
  if (relative >= plan.minDetectableEffect) {
    reasons.push(`credible positive: relative lift ${relative.toFixed(3)} ≥ MDE ${plan.minDetectableEffect}${observational ? " (observational, not estimated incremental lift)" : ""}`);
    return { recommendation: "continue", mature: true, lift, guardrailBreaches: [], reasons, version: TREND_EXPERIMENT_VERSION };
  }
  if (relative <= -plan.minDetectableEffect) {
    reasons.push(`mature and clearly negative: relative lift ${relative.toFixed(3)} ≤ -MDE — roll back to the prior revision`);
    return { recommendation: "rollback", mature: true, lift, guardrailBreaches: [], reasons, version: TREND_EXPERIMENT_VERSION };
  }
  reasons.push(`mature but within ±MDE of flat (relative ${relative.toFixed(3)}) — revise rather than scale on noise`);
  return { recommendation: "revise", mature: true, lift, guardrailBreaches: [], reasons, version: TREND_EXPERIMENT_VERSION };
}

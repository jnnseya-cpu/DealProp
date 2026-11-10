/**
 * Trend Intelligence — detection, scoring and the decision gate (spec §5).
 *
 * This is the deterministic heart of the trend reader. It takes evidence about
 * a demand signal and answers two separate questions, the same way the deal
 * engine's opportunity score does: how good is this opportunity, and how much
 * of that do we actually know?
 *
 *  - The **opportunity score** (0–100) is worth-pursuing: demand, platform fit,
 *    commercial intent, timing and readiness.
 *  - The **confidence** (0–100) is how-much-we-know: source quality, independent
 *    corroboration, coverage and freshness. It is computed independently and it
 *    gates activation — a high score we cannot stand behind is not actioned.
 *
 * Both are deterministic. A model may *suggest* a fit or intent value, but the
 * number that scores only ever comes from a verified mapping (spec §17), the
 * same rule the rest of this codebase applies to an LLM: it proposes, the
 * engine decides (decision #50). Nothing here calls a model.
 *
 * Three rules are load-bearing and each has a test pinning it:
 *
 *  1. **Scores are full precision; rounding is for display only.** The §5
 *     worked example lands on 86.25 / 83.5 and the decision is taken on those
 *     exact numbers, never a rounded 86 / 84 (TI-03). `round1()` exists for a
 *     screen and is never fed back into a decision.
 *  2. **A veto blocks the brief, it does not lower the number.** Out-of-market,
 *     an unsupported claim, a restricted topic, unavailable inventory or
 *     illegal targeting stops a reviewable brief being created at all — the
 *     opportunity can still be watched, and can reopen when the capability
 *     changes, but it cannot go live on a guess.
 *  3. **A single source family caps confidence at 69.** One family cannot
 *     corroborate itself; syndication, mirrors and amendments are one family at
 *     most (spec §3). Two independent families are required before a signal is
 *     confident enough to act on.
 *
 * A feed gap is unknown data, never zero interest (spec §3), so missing inputs
 * lower confidence and are recorded as missing — they never read as a strong
 * negative that would quietly archive a real signal.
 */

export const TREND_SCORING_VERSION = "trend-scoring-1";

/** Round for display only. Never feed the result back into a decision. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

// --- §5.3 movement detection (deterministic) ----------------------------------

/** Natural log of 1 + x. */
function log1p(x: number): number {
  return Math.log1p(x);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) return sorted[mid] ?? 0;
  const lower = sorted[mid - 1] ?? 0;
  const upper = sorted[mid] ?? 0;
  return (lower + upper) / 2;
}

/** Median absolute deviation about the median. */
function mad(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

export interface MovementInput {
  /** Comparable current count for the complete source-native window. */
  readonly current: number;
  /** Baseline median count (e.g. median of the prior eight comparable weeks). */
  readonly baseline: number;
  /** Historical comparable counts used for the robust anomaly score. */
  readonly history: readonly number[];
  /** Count gate, adjustable by source/geography. Default 20 (spec §5.3). */
  readonly minCount?: number;
  /** Anomaly gate, adjustable by source/geography. Default 2 (spec §5.3). */
  readonly minZ?: number;
}

export interface Movement {
  readonly lift: number;
  readonly z: number;
  /** clamp(50 + 10z, 0, 100) after the gates — the reference demand mapping. */
  readonly demandScore: number;
  /** True only when both the count and anomaly gates pass. */
  readonly gatePassed: boolean;
  /** Fewer than four comparable periods: keep draft-only (spec §5.3). */
  readonly insufficientHistory: boolean;
  readonly reasons: readonly string[];
}

/**
 * Per-source movement for a count feed.
 *
 *   lift = ln((c+1)/(b+1))
 *   z    = (log1p(c) − median(log1p(x))) / max(1.4826 × MAD(log1p(x)), 0.2)
 *
 * The 0.2 floor on the scaled MAD stops a quiet, near-constant history from
 * turning a one-event wobble into a huge z. Never apply these raw-count
 * thresholds to an indexed feed (spec §3) — index feeds get their own gates.
 */
export function detectMovement(input: MovementInput): Movement {
  const { current: c, baseline: b, history } = input;
  const minCount = input.minCount ?? 20;
  const minZ = input.minZ ?? 2;

  const lift = Math.log((c + 1) / (b + 1));
  const logs = history.map(log1p);
  const scaledMad = Math.max(1.4826 * mad(logs), 0.2);
  const z = (log1p(c) - median(logs)) / scaledMad;
  const demandScore = clamp(50 + 10 * z, 0, 100);

  const insufficientHistory = history.length < 4;
  const countOk = c >= minCount;
  const zOk = z >= minZ;
  const gatePassed = countOk && zOk && !insufficientHistory;

  const reasons: string[] = [];
  if (!countOk) reasons.push(`count ${c} is below the gate of ${minCount}`);
  if (!zOk) reasons.push(`anomaly z ${round1(z)} is below the gate of ${minZ}`);
  if (insufficientHistory) {
    reasons.push(`only ${history.length} comparable periods (fewer than 4) — draft only`);
  }
  if (gatePassed) reasons.push(`count ${c} and z ${round1(z)} both clear the gate`);

  return { lift, z, demandScore, gatePassed, insufficientHistory, reasons };
}

// --- §5.4 opportunity score ---------------------------------------------------

/** The five weighted components of the opportunity score (spec §5.4). */
export interface OpportunityInputs {
  /** Demand, derived from calibrated source scores. */
  readonly demand: number;
  /** Platform fit: product/category, geography, persona matches. */
  readonly fit: number;
  /** Commercial intent from explicit behaviour and taxonomy. */
  readonly intent: number;
  /** Timing: remaining actionable window. */
  readonly timing: number;
  /** Readiness: stock, partner coverage, capacity, approved assets. */
  readonly readiness: number;
}

/** A reason to refuse live activation regardless of the number (spec §5.4). */
export type TrendVeto =
  | "out-of-market"
  | "unsupported-claim"
  | "restricted-topic"
  | "unavailable-inventory"
  | "illegal-targeting"
  | "missing-readiness";

export const OPPORTUNITY_WEIGHTS = {
  demand: 0.25,
  fit: 0.25,
  intent: 0.2,
  timing: 0.15,
  readiness: 0.15,
} as const;

export function opportunityScore(inputs: OpportunityInputs): number {
  return (
    OPPORTUNITY_WEIGHTS.demand * inputs.demand +
    OPPORTUNITY_WEIGHTS.fit * inputs.fit +
    OPPORTUNITY_WEIGHTS.intent * inputs.intent +
    OPPORTUNITY_WEIGHTS.timing * inputs.timing +
    OPPORTUNITY_WEIGHTS.readiness * inputs.readiness
  );
}

// --- §5.5 confidence ----------------------------------------------------------

export const CONFIDENCE_WEIGHTS = {
  sourceQuality: 0.35,
  corroboration: 0.25,
  coverage: 0.2,
  freshness: 0.2,
} as const;

/** One independent source family's contribution to confidence (spec §17). */
export interface SourceFamilyEvidence {
  readonly family: string;
  /** Configured 0–100 quality score for this family. */
  readonly quality: number;
  /** Mean valid observed/expected window ratio, 0–1. */
  readonly coverage: number;
  /** 0–100, 100 at window close tapering linearly to 0 at the stale limit. */
  readonly freshness: number;
  /** A context-only family (e.g. pageviews) cannot satisfy corroboration. */
  readonly contextOnly?: boolean;
}

/** Corroboration: 0 for one family, 80 for two, 100 for three or more (§17). */
export function corroborationScore(independentFamilies: number): number {
  if (independentFamilies >= 3) return 100;
  if (independentFamilies === 2) return 80;
  return 0;
}

export const SINGLE_FAMILY_CONFIDENCE_CAP = 69;

export interface ConfidenceInputs {
  readonly sourceQuality: number;
  readonly corroboration: number;
  readonly coverage: number;
  readonly freshness: number;
}

export function confidenceScore(inputs: ConfidenceInputs): number {
  return (
    CONFIDENCE_WEIGHTS.sourceQuality * inputs.sourceQuality +
    CONFIDENCE_WEIGHTS.corroboration * inputs.corroboration +
    CONFIDENCE_WEIGHTS.coverage * inputs.coverage +
    CONFIDENCE_WEIGHTS.freshness * inputs.freshness
  );
}

/**
 * Build confidence from the contributing source families (spec §17), applying
 * the single-family cap. Families flagged context-only do not count toward the
 * corroboration family count — pageviews are attention, not corroboration.
 */
export function confidenceFromFamilies(families: readonly SourceFamilyEvidence[]): {
  readonly confidence: number;
  readonly inputs: ConfidenceInputs;
  readonly independentFamilies: number;
  readonly capped: boolean;
} {
  const independent = families.filter((f) => !f.contextOnly);
  const independentFamilies = independent.length;

  const mean = (pick: (f: SourceFamilyEvidence) => number): number =>
    families.length === 0 ? 0 : families.reduce((s, f) => s + pick(f), 0) / families.length;

  const inputs: ConfidenceInputs = {
    sourceQuality: mean((f) => f.quality),
    corroboration: corroborationScore(independentFamilies),
    coverage: mean((f) => clamp(f.coverage, 0, 1)) * 100,
    freshness: mean((f) => f.freshness),
  };

  let confidence = confidenceScore(inputs);
  // A single independent family cannot corroborate itself. Context-only
  // families never lift the count, so a lone real family is still capped.
  const capped = independentFamilies <= 1 && confidence > SINGLE_FAMILY_CONFIDENCE_CAP;
  if (capped) confidence = SINGLE_FAMILY_CONFIDENCE_CAP;

  return { confidence, inputs, independentFamilies, capped };
}

// --- §5 decision gate ---------------------------------------------------------

/**
 * Where an opportunity sits, derived from the score, the confidence and any
 * veto. Mirrors the §5 table and the §6 opportunity state machine.
 *
 *  - `archive`: below the cutoffs. Reopen on new evidence.
 *  - `watch`:   mid-band, or vetoed, or draft-only history. Internal only.
 *  - `brief`:   score ≥75 and confidence ≥75 with no veto. Reviewable brief.
 *  - `auto`:    score ≥85 and confidence ≥85 with tenant opt-in. Bounded auto
 *               action, approved low-risk classes only.
 */
export type TrendDecision = "archive" | "watch" | "brief" | "auto";

export interface DecisionInputs {
  readonly score: number;
  readonly confidence: number;
  readonly vetoes?: readonly TrendVeto[];
  /** Tenant explicitly opted in to bounded automatic action (spec §5 table). */
  readonly autoOptIn?: boolean;
  /** Fewer than four comparable periods anywhere in the evidence. */
  readonly insufficientHistory?: boolean;
}

export interface DecisionResult {
  readonly decision: TrendDecision;
  readonly score: number;
  readonly confidence: number;
  readonly vetoes: readonly TrendVeto[];
  readonly reasons: readonly string[];
}

const ARCHIVE_SCORE = 60;
const ARCHIVE_CONFIDENCE = 55;
const BRIEF_SCORE = 75;
const BRIEF_CONFIDENCE = 75;
const AUTO_SCORE = 85;
const AUTO_CONFIDENCE = 85;

/**
 * The §5 gate. Full precision in, a decision out. The order matters: the floor
 * (archive) is checked first so a weak signal can never be lifted by a veto
 * downgrade, then the ceiling, and a veto or thin history caps the result at
 * `watch` — it can be looked at, never actioned.
 */
export function decide(inputs: DecisionInputs): DecisionResult {
  const { score, confidence } = inputs;
  const vetoes = inputs.vetoes ?? [];
  const reasons: string[] = [];

  let decision: TrendDecision;
  if (score < ARCHIVE_SCORE || confidence < ARCHIVE_CONFIDENCE) {
    decision = "archive";
    reasons.push(
      `score ${round1(score)} < ${ARCHIVE_SCORE} or confidence ${round1(confidence)} < ${ARCHIVE_CONFIDENCE}`,
    );
  } else if (
    score >= AUTO_SCORE &&
    confidence >= AUTO_CONFIDENCE &&
    inputs.autoOptIn === true
  ) {
    decision = "auto";
    reasons.push(`score ${round1(score)} ≥ ${AUTO_SCORE} and confidence ${round1(confidence)} ≥ ${AUTO_CONFIDENCE} with tenant opt-in`);
  } else if (score >= BRIEF_SCORE && confidence >= BRIEF_CONFIDENCE) {
    decision = "brief";
    reasons.push(`score ${round1(score)} ≥ ${BRIEF_SCORE} and confidence ${round1(confidence)} ≥ ${BRIEF_CONFIDENCE}`);
  } else {
    decision = "watch";
    reasons.push(`score ${round1(score)}/confidence ${round1(confidence)} in the watch band`);
  }

  // A veto or thin history never lowers the number, but it forbids going live.
  if (vetoes.length > 0 && (decision === "brief" || decision === "auto")) {
    reasons.push(`vetoed, capped at watch: ${vetoes.join(", ")}`);
    decision = "watch";
  }
  if (inputs.insufficientHistory === true && (decision === "brief" || decision === "auto")) {
    reasons.push("insufficient comparable history — draft only");
    decision = "watch";
  }

  return { decision, score, confidence, vetoes, reasons };
}

// --- combined entry point -----------------------------------------------------

export interface ScoreTrendInput {
  readonly opportunity: OpportunityInputs;
  readonly families: readonly SourceFamilyEvidence[];
  readonly vetoes?: readonly TrendVeto[];
  readonly autoOptIn?: boolean;
  readonly insufficientHistory?: boolean;
}

export interface ScoredTrend {
  readonly opportunityScore: number;
  readonly confidence: number;
  readonly decision: TrendDecision;
  readonly vetoes: readonly TrendVeto[];
  readonly confidenceCapped: boolean;
  readonly independentFamilies: number;
  readonly reasons: readonly string[];
  readonly opportunityInputs: OpportunityInputs;
  readonly confidenceInputs: ConfidenceInputs;
  readonly version: string;
}

/**
 * Score a candidate trend end to end: opportunity, confidence (with the
 * single-family cap), and the decision. Missing readiness is turned into a
 * veto here so the "readiness blocks activation" rule (spec §5.4) is enforced
 * in one place rather than left to each caller.
 */
export function scoreTrend(input: ScoreTrendInput): ScoredTrend {
  const opp = opportunityScore(input.opportunity);
  const conf = confidenceFromFamilies(input.families);

  const vetoes: TrendVeto[] = [...(input.vetoes ?? [])];
  if (input.opportunity.readiness <= 0 && !vetoes.includes("missing-readiness")) {
    vetoes.push("missing-readiness");
  }

  const decision = decide({
    score: opp,
    confidence: conf.confidence,
    vetoes,
    autoOptIn: input.autoOptIn,
    insufficientHistory: input.insufficientHistory,
  });

  return {
    opportunityScore: opp,
    confidence: conf.confidence,
    decision: decision.decision,
    vetoes,
    confidenceCapped: conf.capped,
    independentFamilies: conf.independentFamilies,
    reasons: [...conf.capped ? ["confidence capped at 69: one source family"] : [], ...decision.reasons],
    opportunityInputs: input.opportunity,
    confidenceInputs: conf.inputs,
    version: TREND_SCORING_VERSION,
  };
}

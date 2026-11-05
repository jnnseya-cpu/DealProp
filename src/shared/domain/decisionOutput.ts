import { sub, type Money } from "@shared/money";

/**
 * The LODE decision output (Independent AI Deal Engine spec §3).
 *
 * Every property decision is FOUR separate fields, never one blended verdict:
 *
 *  1. **Investigation priority** — why review now (a documented return, a price
 *     change, a disclosed seller deadline).
 *  2. **Economics** — what the strategy produces under declared inputs: a base,
 *     a downside, and the maximum supported purchase price. Headroom is the
 *     maximum supported price minus the current ask (§3).
 *  3. **Execution blockers** — conditions that can prevent or delay the route. A
 *     blocker does not disappear because the profit is high.
 *  4. **Evidence coverage** — which facts are confirmed, user-reported, inferred
 *     or missing.
 *
 * The verdict precedence encodes §3 exactly: a confirmed blocker shows "Blocked
 * for this strategy" even when the modelled return is positive; incomplete
 * inputs show "Needs evidence" with the missing fields; a negative headroom with
 * complete inputs shows "Below target at asking price". Only a complete,
 * unblocked, positive-headroom deal is within target.
 *
 * Pure: it composes figures the engines already produce (it computes no money of
 * its own beyond the headroom subtraction) so a score, a memorandum and this can
 * never disagree.
 */

export type DecisionVerdict = "within-target" | "below-target" | "needs-evidence" | "blocked";

export interface DecisionEconomics {
  readonly basePence: Money;
  readonly downsidePence: Money;
  readonly maxSupportedPricePence: Money;
  readonly currentAskPence: Money;
  /** maxSupportedPrice − currentAsk. Can be negative. */
  readonly headroomPence: Money;
}

export interface ExecutionBlocker {
  readonly label: string;
  /** False where the blocker is confirmed and unresolved. */
  readonly cleared: boolean;
  readonly nextAction?: string;
}

export interface EvidenceCoverageSummary {
  readonly confirmed: number;
  readonly userReported: number;
  readonly inferred: number;
  /** Fields with no value at all — named, never silently absent. */
  readonly missing: readonly string[];
}

export interface DecisionOutput {
  readonly investigationPriority: readonly string[];
  readonly economics: DecisionEconomics;
  readonly executionBlockers: readonly ExecutionBlocker[];
  readonly evidenceCoverage: EvidenceCoverageSummary;
  readonly verdict: DecisionVerdict;
  readonly statement: string;
  /** The next check that would move the decision, where there is one (§2/§3). */
  readonly nextCheck?: string;
}

export interface DecisionInput {
  readonly investigationPriority: readonly string[];
  readonly basePence: Money;
  readonly downsidePence: Money;
  readonly maxSupportedPricePence: Money;
  readonly currentAskPence: Money;
  readonly executionBlockers: readonly ExecutionBlocker[];
  readonly evidenceCoverage: EvidenceCoverageSummary;
  /** False where a necessary input is absent, forcing "Needs evidence" (§3). */
  readonly inputsComplete: boolean;
}

export function buildDecisionOutput(input: DecisionInput): DecisionOutput {
  const headroomPence = sub(input.maxSupportedPricePence, input.currentAskPence);
  const economics: DecisionEconomics = {
    basePence: input.basePence,
    downsidePence: input.downsidePence,
    maxSupportedPricePence: input.maxSupportedPricePence,
    currentAskPence: input.currentAskPence,
    headroomPence,
  };

  const confirmedBlocker = input.executionBlockers.find((b) => !b.cleared);
  const incomplete = !input.inputsComplete || input.evidenceCoverage.missing.length > 0;

  let verdict: DecisionVerdict;
  let statement: string;
  let nextCheck: string | undefined;

  if (confirmedBlocker !== undefined) {
    // A blocker stands even when the return is positive (§3).
    verdict = "blocked";
    statement = `Blocked for this strategy: ${confirmedBlocker.label}.`;
    nextCheck = confirmedBlocker.nextAction ?? `Resolve: ${confirmedBlocker.label}.`;
  } else if (incomplete) {
    verdict = "needs-evidence";
    const missing = input.evidenceCoverage.missing;
    statement =
      missing.length > 0
        ? `Needs evidence: ${missing.join(", ")}.`
        : "Needs evidence before a decision can be made.";
    nextCheck = missing[0] !== undefined ? `Establish ${missing[0]}.` : "Supply the missing inputs.";
  } else if (Number(headroomPence) < 0) {
    verdict = "below-target";
    statement = "Below target at asking price — the supported price is under the current ask.";
    nextCheck = "Negotiate below the asking price, or pass.";
  } else {
    verdict = "within-target";
    statement = "Within target — complete, unblocked, and supported above the current ask.";
  }

  return {
    investigationPriority: input.investigationPriority,
    economics,
    executionBlockers: input.executionBlockers,
    evidenceCoverage: input.evidenceCoverage,
    verdict,
    statement,
    ...(nextCheck !== undefined ? { nextCheck } : {}),
  };
}

/** Summarise a set of evidence claims into the coverage counts (§3). */
export function summariseCoverage(
  claims: readonly { readonly field: string; readonly confidence: "confirmed" | "user_reported" | "inferred" | "missing" }[],
  requiredFields: readonly string[],
): EvidenceCoverageSummary {
  let confirmed = 0;
  let userReported = 0;
  let inferred = 0;
  const present = new Set<string>();
  for (const c of claims) {
    if (c.confidence === "confirmed") {
      confirmed += 1;
      present.add(c.field);
    } else if (c.confidence === "user_reported") {
      userReported += 1;
      present.add(c.field);
    } else if (c.confidence === "inferred") {
      inferred += 1;
      present.add(c.field);
    }
    // "missing" claims record the absence; they do not count as present.
  }
  const missing = requiredFields.filter((f) => !present.has(f));
  return { confirmed, userReported, inferred, missing };
}

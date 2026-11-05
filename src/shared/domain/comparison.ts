import type { Money } from "@shared/money";
import type { DecisionOutput, DecisionVerdict } from "@shared/domain/decisionOutput";

/**
 * Compare and Decide (Independent AI Deal Engine spec §2/§3, IND08).
 *
 * Up to four properties, judged under ONE shared assumption set — the same rate,
 * cost and downside definitions applied across all of them — so the outputs
 * genuinely align and are comparable. Each property keeps its own decision
 * (headroom, verdict, blockers, next check), and any property-specific cost
 * override is carried and flagged, never silently folded in: a reader must be
 * able to see where one deal departs from the shared assumptions (IND08).
 *
 * Pure: the per-property decision outputs are computed upstream under the shared
 * assumptions and handed in; this freezes the set, enforces the cap, and aligns
 * them into comparable columns. It is never more than four, because a comparison
 * a human cannot hold in their head is not a comparison.
 */

export const MIN_COMPARISON = 2;
export const MAX_COMPARISON = 4;

export interface SharedAssumptions {
  readonly version: string;
  readonly strategy: string;
  readonly financeRateBps: number;
  readonly downsideDefinition: string;
}

export interface ComparisonEntry {
  readonly propertyId: string;
  readonly label: string;
  readonly decision: DecisionOutput;
  readonly appraisalId?: string;
  readonly selectedScenarioId?: string;
  readonly calculationId?: string;
  readonly equityRequiredPence?: Money;
  readonly allInCostsPence?: Money;
  /** Property-specific cost overrides, shown separately from the shared set. */
  readonly overrides?: readonly { readonly field: string; readonly value: string }[];
}

export interface ComparisonRun {
  readonly id: string;
  readonly tenantId: string;
  readonly investorId: string;
  readonly sharedAssumptions: SharedAssumptions;
  readonly entries: readonly ComparisonEntry[];
  readonly resultWatermark: string;
  readonly createdAt: string;
}

export interface BuildComparisonInput {
  readonly id: string;
  readonly tenantId: string;
  readonly investorId: string;
  readonly sharedAssumptions: SharedAssumptions;
  readonly entries: readonly ComparisonEntry[];
  readonly createdAt: string;
}

export type BuildComparisonResult =
  | { readonly ok: true; readonly run: ComparisonRun }
  | { readonly ok: false; readonly reason: string };

export function buildComparisonRun(input: BuildComparisonInput): BuildComparisonResult {
  if (input.entries.length < MIN_COMPARISON) {
    return { ok: false, reason: `A comparison needs at least ${MIN_COMPARISON} properties.` };
  }
  if (input.entries.length > MAX_COMPARISON) {
    return { ok: false, reason: `A comparison holds at most ${MAX_COMPARISON} properties.` };
  }
  const ids = new Set(input.entries.map((e) => e.propertyId));
  if (ids.size !== input.entries.length) {
    return { ok: false, reason: "The same property cannot appear twice in one comparison." };
  }
  return {
    ok: true,
    run: {
      id: input.id,
      tenantId: input.tenantId,
      investorId: input.investorId,
      sharedAssumptions: input.sharedAssumptions,
      entries: input.entries,
      resultWatermark: input.createdAt,
      createdAt: input.createdAt,
    },
  };
}

export interface ComparisonColumn {
  readonly propertyId: string;
  readonly label: string;
  readonly verdict: DecisionVerdict;
  readonly maxSupportedPricePence: Money;
  readonly currentAskPence: Money;
  readonly headroomPence: Money;
  readonly basePence: Money;
  readonly downsidePence: Money;
  readonly equityRequiredPence?: Money;
  readonly allInCostsPence?: Money;
  readonly blockers: readonly string[];
  readonly missing: readonly string[];
  readonly nextCheck?: string;
  /** True where this property departs from the shared assumptions (IND08). */
  readonly hasOverrides: boolean;
  readonly overrides: readonly { readonly field: string; readonly value: string }[];
}

/** Align the entries into comparable columns under the one shared assumption set. */
export function alignComparison(run: ComparisonRun): readonly ComparisonColumn[] {
  return run.entries.map((e) => {
    const econ = e.decision.economics;
    const blockers = e.decision.executionBlockers.filter((b) => !b.cleared).map((b) => b.label);
    return {
      propertyId: e.propertyId,
      label: e.label,
      verdict: e.decision.verdict,
      maxSupportedPricePence: econ.maxSupportedPricePence,
      currentAskPence: econ.currentAskPence,
      headroomPence: econ.headroomPence,
      basePence: econ.basePence,
      downsidePence: econ.downsidePence,
      ...(e.equityRequiredPence !== undefined ? { equityRequiredPence: e.equityRequiredPence } : {}),
      ...(e.allInCostsPence !== undefined ? { allInCostsPence: e.allInCostsPence } : {}),
      blockers,
      missing: e.decision.evidenceCoverage.missing,
      ...(e.decision.nextCheck !== undefined ? { nextCheck: e.decision.nextCheck } : {}),
      hasOverrides: e.overrides !== undefined && e.overrides.length > 0,
      overrides: e.overrides ?? [],
    };
  });
}

import type { Bps, Money } from "@shared/money";
import type { DealHuntCriteria } from "@shared/domain/dealHunt";

/**
 * Deal Hunt persistence records and the run lifecycle (Deal Hunt spec §5/§6).
 *
 * A hunt is three immutable things: the confirmed **query** (editing it makes a
 * new revision, never a mutation), the **run** that executed it over a frozen
 * source watermark, and the evidenced **results** it produced. The run walks a
 * small state machine the UI reads (queued → searching → enriching → completed,
 * or partial/failed/cancelled), and a result snapshot is immutable once written
 * — a later observation marks it stale rather than rewriting it (DH07).
 *
 * Pure and framework-free: the worker in `backend/dealHunt/` drives these, the
 * store persists them, and the matcher in `marketWatch.ts` produces the
 * eligibility proof each result carries.
 */

export const DEAL_HUNT_POLICY_VERSION = "deal-hunt-1";

/** Single-tenant today; the field is kept because the contract is tenant-scoped. */
export const DEFAULT_TENANT = "lode";

export interface DealHuntQuery {
  readonly id: string;
  readonly tenantId: string;
  readonly investorId: string;
  /** Editing filters creates a new immutable revision (spec §2). */
  readonly revision: number;
  readonly criteria: DealHuntCriteria;
  readonly policyVersion: string;
  /** A reference to the retained raw brief; the brief text is sealed elsewhere. */
  readonly briefRef?: string;
  readonly confirmedAt: string;
}

export type DealHuntRunState =
  | "queued"
  | "searching"
  | "enriching"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

const TERMINAL: readonly DealHuntRunState[] = ["completed", "partial", "failed", "cancelled"];

export function isTerminalRun(state: DealHuntRunState): boolean {
  return TERMINAL.includes(state);
}

export interface DealHuntRunCounts {
  readonly eligible: number;
  readonly excluded: number;
  /** True where the eligible set was larger than the result limit (spec §2). */
  readonly capped: boolean;
}

export interface DealHuntRun {
  readonly id: string;
  readonly queryId: string;
  readonly investorId: string;
  readonly state: DealHuntRunState;
  /** The observation watermark frozen at the start, so the run is reproducible. */
  readonly sourceWatermark: string;
  /** The UTC anchor the return window is measured against (spec §3). */
  readonly runAt: string;
  readonly attempts: number;
  readonly cancellationToken?: string;
  readonly counts?: DealHuntRunCounts;
  /** A plain coverage boundary statement, shown on zero-match too (DH16). */
  readonly coverage: string;
  readonly errorCode?: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Set once a completion notification has been emitted (DH12 — exactly once). */
  readonly notifiedAt?: string;
}

export type ReturnReasonClass =
  | "confirmed_fall_through"
  | "returned_to_market_reason_unverified";

export type EnrichmentStatus = "pending" | "ready" | "missing" | "failed";

export interface DealHuntResult {
  readonly id: string;
  readonly runId: string;
  readonly propertyId: string;
  readonly listingId: string;
  /** Identifies the qualifying marketing episode; dedupe is by property (DH09). */
  readonly episodeKey: string;
  // --- eligibility proof (spec §3) ---
  readonly baselineObservationId: string;
  readonly currentObservationId: string;
  readonly returnEventObservationId: string;
  readonly reason: ReturnReasonClass;
  readonly confirmationEvidenceId?: string;
  readonly baselinePence: Money;
  readonly currentPence: Money;
  readonly dropPence: Money;
  readonly dropBps: Bps;
  readonly rank: number;
  readonly resultWatermark: string;
  readonly matchReasons: readonly string[];
  /** Source keys the property surfaced on — one card, provenance kept (DH09). */
  readonly provenance: readonly string[];
  /** A newer observation invalidated the snapshot; recheck on handoff (DH07). */
  readonly stale: boolean;
  // --- enrichment (spec §4) ---
  readonly evidenceBundleId?: string;
  readonly enrichment: { readonly sold: EnrichmentStatus; readonly rent: EnrichmentStatus };
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

export function queueRun(input: {
  id: string;
  queryId: string;
  investorId: string;
  sourceWatermark: string;
  runAt: string;
  correlationId: string;
  now: string;
  coverage?: string;
}): DealHuntRun {
  return {
    id: input.id,
    queryId: input.queryId,
    investorId: input.investorId,
    state: "queued",
    sourceWatermark: input.sourceWatermark,
    runAt: input.runAt,
    attempts: 0,
    coverage: input.coverage ?? "Queued.",
    correlationId: input.correlationId,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * Move a run to a new state. A terminal run never changes again (cancelled jobs
 * produce no completion alert, a completed run is not re-run in place). Returns
 * the same run unchanged where the move is not allowed, so a late retry is a
 * no-op rather than a rewrite.
 */
export function advanceRun(
  run: DealHuntRun,
  state: DealHuntRunState,
  patch: Partial<Pick<DealHuntRun, "counts" | "coverage" | "errorCode" | "notifiedAt" | "cancellationToken">> & { now: string },
): DealHuntRun {
  if (isTerminalRun(run.state)) return run;
  const bumpAttempt = state === "searching" && run.state === "queued";
  return {
    ...run,
    state,
    ...(patch.counts !== undefined ? { counts: patch.counts } : {}),
    ...(patch.coverage !== undefined ? { coverage: patch.coverage } : {}),
    ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
    ...(patch.notifiedAt !== undefined ? { notifiedAt: patch.notifiedAt } : {}),
    ...(patch.cancellationToken !== undefined ? { cancellationToken: patch.cancellationToken } : {}),
    attempts: bumpAttempt ? run.attempts + 1 : run.attempts,
    updatedAt: patch.now,
  };
}

/** Rank per spec §3.6: newest return, then larger reduction, then stable id. */
export function rankResults(
  results: readonly Omit<DealHuntResult, "rank">[],
): DealHuntResult[] {
  return [...results]
    .sort((a, b) => {
      const byReturn = b.resultWatermark.localeCompare(a.resultWatermark);
      if (byReturn !== 0) return byReturn;
      if (b.dropPence !== a.dropPence) return Number(b.dropPence) - Number(a.dropPence);
      return a.propertyId.localeCompare(b.propertyId);
    })
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

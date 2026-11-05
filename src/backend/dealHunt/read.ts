import {
  getComparableBundle,
  getDealHuntRun,
  listDealHuntResults,
  listEvidenceClaims,
  listDecisionSnapshots,
  getWatchCursor,
} from "@backend/store/repository";
import { decisionFromResult } from "@shared/domain/dealHuntDecision";
import type { DecisionOutput } from "@shared/domain/decisionOutput";
import type { DealHuntRun } from "@shared/domain/dealHuntRun";
import type { StoredComparableBundle } from "@backend/store/schema";

/**
 * One place that assembles everything a Deal Hunt detail view needs — the run,
 * its results, each result's comparable bundle, the composed §3 decision, which
 * results already have a saved snapshot, and whether the search is watched.
 *
 * Shared by the operator console and the investor surface so the read logic has
 * one source of truth (and the two surfaces cannot drift apart).
 */
export interface HuntDetail {
  readonly run: DealHuntRun;
  readonly results: Awaited<ReturnType<typeof listDealHuntResults>>;
  readonly bundles: Map<string, StoredComparableBundle>;
  readonly decisions: Map<string, DecisionOutput>;
  readonly snapshotByResult: Set<string>;
  readonly watched: boolean;
}

export async function loadHuntDetail(runId: string): Promise<HuntDetail | undefined> {
  const run = await getDealHuntRun(runId);
  if (run === undefined) return undefined;

  const results = await listDealHuntResults(runId);
  const bundles = new Map<string, StoredComparableBundle>();
  const decisions = new Map<string, DecisionOutput>();
  const snapshotByResult = new Set<string>();
  for (const r of results) {
    const stored = r.evidenceBundleId !== undefined ? await getComparableBundle(r.evidenceBundleId) : undefined;
    if (stored !== undefined) bundles.set(r.id, stored);
    const claims = await listEvidenceClaims(r.propertyId);
    decisions.set(r.id, decisionFromResult(r, stored?.bundle, claims));
    if ((await listDecisionSnapshots(r.id)).length > 0) snapshotByResult.add(r.id);
  }
  const watched = (await getWatchCursor(`watch-${run.queryId}`)) !== undefined;

  return { run, results, bundles, decisions, snapshotByResult, watched };
}

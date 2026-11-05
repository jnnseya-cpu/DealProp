"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { createAndRunHunt } from "@backend/dealHunt/service";
import { openAppraisalFromResult } from "@backend/dealHunt/handoff";
import { runDealHuntJob } from "@backend/dealHunt/worker";
import { dealHuntSource } from "@backend/dealHunt/fixtureSource";
import { randomUUID } from "node:crypto";
import {
  getDealHuntRun,
  getDealHuntResult,
  getComparableBundle,
  listEvidenceClaims,
  saveDecisionSnapshot,
  saveComparisonRun,
  saveWatchCursor,
  getWatchCursor,
  getDealHuntQuery,
  recordNotification,
} from "@backend/store/repository";
import { decisionFromResult } from "@shared/domain/dealHuntDecision";
import { createDecisionSnapshot } from "@shared/domain/decisionSnapshot";
import { buildComparisonRun, type ComparisonEntry, type SharedAssumptions } from "@shared/domain/comparison";
import { createWatch, issueWatchEvents, type WatchCandidate } from "@shared/domain/watchCursor";
import { fromMajor } from "@shared/money";
import type { CriteriaDraft } from "@shared/domain/dealHunt";

const DH_SHARED_ASSUMPTIONS: SharedAssumptions = {
  version: "dh-decision-1",
  strategy: "returned-and-reduced",
  financeRateBps: 0,
  downsideDefinition: "conservative as-is low valuation vs current ask",
};

/**
 * Run a confirmed Deal Hunt. Its own POST endpoint, checking its own permission
 * (#29); a hunt is attributed to the named operator's account, never the shared
 * password. The draft is re-validated server-side — the browser's values are an
 * input, not a decision (DH02).
 */
export async function runHuntAction(formData: FormData): Promise<void> {
  const viewer = await requirePermission("view-audit-log", "/operator/hunts");
  const account = viewerAccount(viewer);
  const brief = String(formData.get("brief") ?? "");
  const backTo = `/operator/hunts?brief=${encodeURIComponent(brief)}`;
  if (account === undefined) {
    redirect(`${backTo}&error=${encodeURIComponent("A hunt needs a named operator account, not the shared password.")}`);
  }

  const str = (k: string): string => String(formData.get(k) ?? "").trim();
  const intOrUndef = (k: string): number | undefined => {
    const v = str(k);
    if (v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : undefined;
  };

  const priceMajor = intOrUndef("priceCeilingMajor");
  const dropPercent = Number(str("minimumDropPercent"));
  const types = str("propertyTypes")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t !== "");
  const operator = str("priceOperator") === "lte" ? "lte" : "lt";
  const event = str("eventRequirement") === "confirmed_fall_through" ? "confirmed_fall_through" : "returned_to_market";

  const draft: CriteriaDraft = {
    geographyId: str("geographyId"),
    propertyTypes: types,
    ...(intOrUndef("bedroomsMin") !== undefined ? { bedroomsMin: intOrUndef("bedroomsMin") } : {}),
    ...(intOrUndef("bedroomsMax") !== undefined ? { bedroomsMax: intOrUndef("bedroomsMax") } : {}),
    ...(priceMajor !== undefined ? { askingPriceLimitPence: Number(fromMajor(priceMajor)) } : {}),
    priceOperator: operator,
    ...(intOrUndef("returnedWithinDays") !== undefined ? { returnedWithinDays: intOrUndef("returnedWithinDays") } : {}),
    eventRequirement: event,
    minimumDropBps: Number.isFinite(dropPercent) ? Math.round(dropPercent * 100) : 0,
  };

  const result = await createAndRunHunt({ investorId: account.id, draft, briefRef: brief.slice(0, 500) });
  if (!result.ok || result.outcome === undefined) {
    const msg = (result.errors ?? ["The hunt could not be run."]).join(" ");
    redirect(`${backTo}&error=${encodeURIComponent(msg)}`);
  }
  redirect(`/operator/hunts/${result.outcome.run.id}`);
}

/**
 * Open an appraisal draft from a Deal Hunt result (spec §6). Idempotent per
 * investor + result (DH15); entitlement is re-checked at handoff (DH13). Its own
 * POST endpoint checking its own permission (#29).
 */
export async function openAppraisalAction(formData: FormData): Promise<void> {
  const viewer = await requirePermission("view-audit-log", "/operator/hunts");
  const resultId = String(formData.get("resultId") ?? "");
  const runId = String(formData.get("runId") ?? "");
  if (resultId === "" || runId === "") return;
  const run = await getDealHuntRun(runId);
  const investorId = run?.investorId ?? viewerAccount(viewer)?.id ?? "unknown";
  await openAppraisalFromResult(resultId, investorId);
  revalidatePath(`/operator/hunts/${runId}`);
}

/**
 * Save a decision snapshot for a Deal Hunt result (§5). Composes the §3 decision
 * from the stored evidence and freezes it, attributed to the named operator.
 * Its own POST endpoint checking its own permission (#29/#32).
 */
export async function saveSnapshotAction(formData: FormData): Promise<void> {
  const viewer = await requirePermission("view-audit-log", "/operator/hunts");
  const account = viewerAccount(viewer);
  const resultId = String(formData.get("resultId") ?? "");
  const runId = String(formData.get("runId") ?? "");
  if (account === undefined || resultId === "" || runId === "") return;

  const result = await getDealHuntResult(resultId);
  if (result === undefined) return;
  const bundle = result.evidenceBundleId !== undefined ? await getComparableBundle(result.evidenceBundleId) : undefined;
  const claims = await listEvidenceClaims(result.propertyId);
  const decision = decisionFromResult(result, bundle?.bundle, claims);

  const now = new Date().toISOString();
  const created = createDecisionSnapshot({
    id: `snap-${runId}-${resultId}`,
    tenantId: "lode",
    subjectId: resultId,
    subjectType: "deal-hunt-result",
    actorId: account.id,
    evidenceSetVersion: `ev-${resultId}-${claims.length}`,
    calculationIds: bundle !== undefined ? [bundle.id] : [],
    decision,
    reasonCodes: [decision.verdict],
    visibility: "reviewer",
    createdAt: now,
    permitted: true,
    // A reviewer (internal) snapshot has no external publication gate at the
    // research stage; sharing to an investor would recheck material-information
    // and identity/funding gates before publishing.
    publicationGatesClear: true,
  });
  if (created.ok) await saveDecisionSnapshot(created.snapshot);
  revalidatePath(`/operator/hunts/${runId}`);
}

/**
 * Compare up to four selected results under one shared assumption set (IND08),
 * persist the ComparisonRun, and open it. Its own POST endpoint (#29).
 */
export async function compareAction(formData: FormData): Promise<void> {
  const viewer = await requirePermission("view-audit-log", "/operator/hunts");
  const account = viewerAccount(viewer);
  const runId = String(formData.get("runId") ?? "");
  const ids = formData.getAll("ids").map((v) => String(v)).filter((v) => v !== "");
  const backTo = `/operator/hunts/${runId}`;
  if (account === undefined) redirect(`${backTo}?error=named-account-required`);
  if (ids.length < 2) redirect(`${backTo}?error=${encodeURIComponent("Select at least two results to compare.")}`);

  const entries: ComparisonEntry[] = [];
  for (const id of ids.slice(0, 4)) {
    const result = await getDealHuntResult(id);
    if (result === undefined) continue;
    const bundle = result.evidenceBundleId !== undefined ? await getComparableBundle(result.evidenceBundleId) : undefined;
    const claims = await listEvidenceClaims(result.propertyId);
    entries.push({
      propertyId: result.propertyId,
      label: result.propertyId,
      decision: decisionFromResult(result, bundle?.bundle, claims),
    });
  }

  const built = buildComparisonRun({
    id: randomUUID(),
    tenantId: "lode",
    investorId: account.id,
    sharedAssumptions: DH_SHARED_ASSUMPTIONS,
    entries,
    createdAt: new Date().toISOString(),
  });
  if (!built.ok) redirect(`${backTo}?error=${encodeURIComponent(built.reason)}`);
  await saveComparisonRun(built.run);
  redirect(`/operator/hunts/compare/${built.run.id}`);
}

/**
 * Save this hunt as a watch ("Watch this search"), so new qualifying episodes
 * alert the owner. Its own POST endpoint (#29).
 */
export async function watchHuntAction(formData: FormData): Promise<void> {
  const viewer = await requirePermission("view-audit-log", "/operator/hunts");
  const account = viewerAccount(viewer);
  const runId = String(formData.get("runId") ?? "");
  if (account === undefined || runId === "") return;
  const run = await getDealHuntRun(runId);
  if (run === undefined) return;
  const query = await getDealHuntQuery(run.queryId);
  if (query === undefined) return;

  const now = new Date().toISOString();
  const watch = createWatch({
    id: `watch-${query.id}`,
    tenantId: "lode",
    ownerId: account.id,
    queryId: query.id,
    queryRevision: query.revision,
    scope: "search",
    now,
  });
  await saveWatchCursor(watch);
  revalidatePath(`/operator/hunts/${runId}`);
}

/**
 * Re-run a saved watch now: execute its query, emit one alert per genuinely new
 * qualifying episode (deduplicated by watch/property/episode, IND13), advance the
 * cursor and record the alerts in-app. Its own POST endpoint (#29).
 */
export async function runWatchAction(formData: FormData): Promise<void> {
  const viewer = await requirePermission("view-audit-log", "/operator/hunts");
  const account = viewerAccount(viewer);
  const watchId = String(formData.get("watchId") ?? "");
  if (account === undefined || watchId === "") return;
  const watch = await getWatchCursor(watchId);
  if (watch === undefined) return;
  const query = await getDealHuntQuery(watch.queryId);
  if (query === undefined) return;

  const outcome = await runDealHuntJob(query, dealHuntSource());
  const candidates: WatchCandidate[] = outcome.results.map((r) => ({
    propertyId: r.propertyId,
    episodeKey: r.episodeKey,
    at: r.resultWatermark,
  }));
  const now = new Date().toISOString();
  const { events, watch: advanced } = issueWatchEvents(watch, candidates, now);
  await saveWatchCursor(advanced);

  for (const e of events) {
    await recordNotification({
      id: randomUUID(),
      eventKey: `watch-${watch.id}-${e.propertyId}-${e.episodeKey}`,
      recipientAccountId: watch.ownerId,
      channel: "inapp",
      lawfulBasis: "service",
      severity: "info",
      status: "logged",
      subject: `Deal Hunt watch: ${e.kind === "materially-changed" ? "a match changed" : "a new match"} (${e.propertyId})`,
      createdAt: now,
    });
  }
  revalidatePath("/operator/hunts");
}

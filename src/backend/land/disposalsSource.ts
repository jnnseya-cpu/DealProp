import { Fetcher, type FetchOutcome } from "@backend/discovery/fetcher";
import { mapDisposalRelease, type LandDisposal, type OcdsRelease } from "@shared/domain/land/disposals";

/**
 * The Contracts Finder connector — public-sector land & property disposals.
 *
 * Reaches the one bound host through the single sanctioned outbound path
 * (`Fetcher`, decision #39). The OGL OCDS search returns releases; the pure
 * classifier keeps only genuine disposals. This file only fetches and parses.
 *
 * NOT yet live-verified from this environment (egress blocked; `create_session`
 * onto the net-enabled environment refused). The exact search endpoint and query
 * parameters are confirmed against one real request before this is relied on —
 * the same honest posture as the planning-map and brownfield connectors. A
 * silent empty is unknown coverage, never "no disposals".
 */

const SEARCH = "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search";

export interface DisposalsQuery {
  /** ISO 8601 lower bound on publication date — the API's real filter. */
  readonly publishedFrom?: string;
  /** OCDS stages to include: planning | tender | award | implementation. */
  readonly stages?: readonly string[];
  /** 1–100; the API's page size. */
  readonly limit?: number;
  /** Opaque pagination cursor the API returns for the next page. */
  readonly cursor?: string;
}

export interface DisposalsFetchResult {
  readonly ok: boolean;
  readonly outcome: FetchOutcome;
  readonly disposals: readonly LandDisposal[];
  /** Raw notices in this page (before the disposal filter), to drive pagination. */
  readonly received: number;
  /** Cursor for the next page, when the API reports more. */
  readonly nextCursor?: string;
  readonly reason: string;
}

export function buildDisposalsUrl(q: DisposalsQuery): string {
  // The current Contracts Finder OCDS API has NO keyword search (confirmed
  // against the official API docs). It returns recent notices filtered by date
  // and stage; the disposal classifier does the land/property filtering
  // client-side. "tender" and "planning" are the stages a disposal/opportunity
  // notice appears under.
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(Math.max(q.limit ?? 100, 1), 100)));
  params.set("stages", (q.stages ?? ["tender", "planning"]).join(","));
  if (q.publishedFrom !== undefined) params.set("publishedFrom", q.publishedFrom);
  if (q.cursor !== undefined) params.set("cursor", q.cursor);
  return `${SEARCH}?${params.toString()}`;
}

/** The cursor for the next page, parsed from the response's `links.next`. */
export function nextCursorFrom(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { links?: { next?: unknown } };
    const next = parsed.links?.next;
    if (typeof next !== "string" || next === "") return undefined;
    const url = new URL(next, SEARCH);
    return url.searchParams.get("cursor") ?? undefined;
  } catch {
    return undefined;
  }
}

/** Pull OCDS releases out of whatever envelope Contracts Finder returned. */
export function releasesFrom(body: string): readonly OcdsRelease[] {
  try {
    const parsed = JSON.parse(body) as unknown;
    const out: OcdsRelease[] = [];
    const pushReleases = (obj: unknown): void => {
      if (obj === null || typeof obj !== "object") return;
      const rec = obj as { releases?: unknown; release?: unknown };
      if (Array.isArray(rec.releases)) out.push(...(rec.releases as OcdsRelease[]));
      else if (rec.release !== undefined) out.push(rec.release as OcdsRelease);
      else out.push(obj as OcdsRelease);
    };
    if (parsed !== null && typeof parsed === "object" && Array.isArray((parsed as { results?: unknown }).results)) {
      for (const r of (parsed as { results: unknown[] }).results) pushReleases(r);
      return out;
    }
    if (parsed !== null && typeof parsed === "object" && Array.isArray((parsed as { releases?: unknown }).releases)) {
      return (parsed as { releases: OcdsRelease[] }).releases;
    }
    if (Array.isArray(parsed)) {
      for (const r of parsed) pushReleases(r);
      return out;
    }
    return [];
  } catch {
    return [];
  }
}

export async function fetchDisposals(fetcher: Fetcher, query: DisposalsQuery): Promise<DisposalsFetchResult> {
  const result = await fetcher.get("contracts-finder", buildDisposalsUrl(query));
  if (!result.ok || result.body === undefined) {
    return { ok: false, outcome: result.outcome, disposals: [], received: 0, reason: result.reason };
  }
  const releases = releasesFrom(result.body);
  const disposals = releases.map(mapDisposalRelease).filter((d): d is LandDisposal => d !== undefined);
  const nextCursor = nextCursorFrom(result.body);
  return {
    ok: true,
    outcome: "ok",
    disposals,
    received: releases.length,
    ...(nextCursor !== undefined ? { nextCursor } : {}),
    reason: `contracts-finder: ${disposals.length} disposal(s) in ${releases.length} notice(s)`,
  };
}

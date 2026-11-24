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
  readonly keyword?: string;
  readonly limit?: number;
}

export interface DisposalsFetchResult {
  readonly ok: boolean;
  readonly outcome: FetchOutcome;
  readonly disposals: readonly LandDisposal[];
  readonly reason: string;
}

export function buildDisposalsUrl(q: DisposalsQuery): string {
  const params = new URLSearchParams();
  params.set("keywords", q.keyword ?? "disposal land development opportunity freehold");
  params.set("limit", String(q.limit ?? 100));
  return `${SEARCH}?${params.toString()}`;
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
    return { ok: false, outcome: result.outcome, disposals: [], reason: result.reason };
  }
  const disposals = releasesFrom(result.body)
    .map(mapDisposalRelease)
    .filter((d): d is LandDisposal => d !== undefined);
  return { ok: true, outcome: "ok", disposals, reason: `contracts-finder: ${disposals.length} disposal(s)` };
}

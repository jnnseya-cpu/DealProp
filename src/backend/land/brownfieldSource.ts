import { Fetcher, type FetchOutcome } from "@backend/discovery/fetcher";
import {
  mapBrownfieldEntity,
  type BrownfieldEntity,
  type LandOpportunity,
} from "@shared/domain/land/brownfield";

/**
 * The Brownfield Land Registers connector — the licensed, free "find me
 * development sites" feed.
 *
 * It reaches the one host the source is bound to, through the single sanctioned
 * outbound path (`Fetcher`, decision #39): licence gate, host allowlist, HTTPS,
 * robots, rate limit. The response is mapped to opportunities by the pure
 * mapper; this file only fetches and parses.
 *
 * NOT yet live-verified from this environment (egress is blocked in the build
 * sandbox, and `create_session` onto the net-enabled environment was refused).
 * The exact `brownfield-land` query parameters for an AREA — point vs bounding
 * box vs organisation filter — are confirmed against one real request before
 * this is relied on, the same honest posture as the planning-map connector. A
 * silent empty result is treated as unknown coverage, never "no sites here".
 */

const BASE = "https://www.planning.data.gov.uk/entity.json";

export interface BrownfieldQuery {
  /** Point to search around, where the platform's point filter is used. */
  readonly longitude?: number;
  readonly latitude?: number;
  readonly limit?: number;
}

export interface BrownfieldFetchResult {
  readonly ok: boolean;
  readonly outcome: FetchOutcome;
  readonly opportunities: readonly LandOpportunity[];
  readonly reason: string;
}

export function buildBrownfieldUrl(q: BrownfieldQuery): string {
  const params = new URLSearchParams();
  params.set("dataset", "brownfield-land");
  params.set("limit", String(q.limit ?? 500));
  if (q.longitude !== undefined && q.latitude !== undefined) {
    params.set("longitude", String(q.longitude));
    params.set("latitude", String(q.latitude));
  }
  return `${BASE}?${params.toString()}`;
}

function entitiesFrom(body: string): readonly BrownfieldEntity[] {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed !== null && typeof parsed === "object" && Array.isArray((parsed as { entities?: unknown }).entities)) {
      return (parsed as { entities: BrownfieldEntity[] }).entities;
    }
    if (Array.isArray(parsed)) return parsed as BrownfieldEntity[];
    return [];
  } catch {
    return [];
  }
}

export async function fetchBrownfieldSites(
  fetcher: Fetcher,
  query: BrownfieldQuery,
): Promise<BrownfieldFetchResult> {
  const result = await fetcher.get("brownfield-land", buildBrownfieldUrl(query));
  if (!result.ok || result.body === undefined) {
    return { ok: false, outcome: result.outcome, opportunities: [], reason: result.reason };
  }
  const opportunities = entitiesFrom(result.body)
    .map(mapBrownfieldEntity)
    .filter((o): o is LandOpportunity => o !== undefined);
  return {
    ok: true,
    outcome: "ok",
    opportunities,
    reason: `brownfield-land: ${opportunities.length} usable site(s)`,
  };
}

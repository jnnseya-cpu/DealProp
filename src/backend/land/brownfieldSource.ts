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

export interface BoundingBox {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface BrownfieldQuery {
  /** Point to search at (returns the site whose polygon contains the point). */
  readonly longitude?: number;
  readonly latitude?: number;
  /** Region to search within (returns every site intersecting the box). */
  readonly bbox?: BoundingBox;
  /** Publishing authorities to filter to, by Planning Data entity id. */
  readonly organisationEntities?: readonly number[];
  readonly limit?: number;
  /** Pagination offset (the platform paginates with `offset`). */
  readonly offset?: number;
}

/** A bbox as a closed WKT polygon ring, "lng lat" pairs (the platform's order). */
export function bboxPolygon(b: BoundingBox): string {
  const { west: w, south: s, east: e, north: n } = b;
  return `POLYGON((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))`;
}

export interface BrownfieldFetchResult {
  readonly ok: boolean;
  readonly outcome: FetchOutcome;
  readonly opportunities: readonly LandOpportunity[];
  /** Raw entities in this page (before mapping drops any), to drive pagination. */
  readonly received: number;
  /** Total matching the query (across all pages), as the platform reports it. */
  readonly count?: number;
  /** True when the platform capped the count (there are more than it states). */
  readonly capped?: boolean;
  readonly reason: string;
}

export function buildBrownfieldUrl(q: BrownfieldQuery): string {
  const params = new URLSearchParams();
  params.set("dataset", "brownfield-land");
  params.set("limit", String(q.limit ?? 500));
  if (q.bbox !== undefined) {
    // Region query: every site whose polygon intersects the box.
    params.set("geometry", bboxPolygon(q.bbox));
    params.set("geometry_relation", "intersects");
  } else if (q.longitude !== undefined && q.latitude !== undefined) {
    params.set("longitude", String(q.longitude));
    params.set("latitude", String(q.latitude));
  }
  for (const id of q.organisationEntities ?? []) params.append("organisation_entity", String(id));
  if (q.offset !== undefined && q.offset > 0) params.set("offset", String(q.offset));
  return `${BASE}?${params.toString()}`;
}

interface ParsedBody {
  readonly entities: readonly BrownfieldEntity[];
  readonly count?: number;
  readonly capped?: boolean;
}

function parseBody(body: string): ParsedBody {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (Array.isArray(parsed)) return { entities: parsed as BrownfieldEntity[] };
    if (parsed !== null && typeof parsed === "object") {
      const obj = parsed as { entities?: unknown; count?: unknown; count_is_capped?: unknown };
      const entities = Array.isArray(obj.entities) ? (obj.entities as BrownfieldEntity[]) : [];
      return {
        entities,
        ...(typeof obj.count === "number" ? { count: obj.count } : {}),
        ...(typeof obj.count_is_capped === "boolean" ? { capped: obj.count_is_capped } : {}),
      };
    }
    return { entities: [] };
  } catch {
    return { entities: [] };
  }
}

export async function fetchBrownfieldSites(
  fetcher: Fetcher,
  query: BrownfieldQuery,
): Promise<BrownfieldFetchResult> {
  const result = await fetcher.get("brownfield-land", buildBrownfieldUrl(query));
  if (!result.ok || result.body === undefined) {
    return { ok: false, outcome: result.outcome, opportunities: [], received: 0, reason: result.reason };
  }
  const parsed = parseBody(result.body);
  const opportunities = parsed.entities
    .map(mapBrownfieldEntity)
    .filter((o): o is LandOpportunity => o !== undefined);
  return {
    ok: true,
    outcome: "ok",
    opportunities,
    received: parsed.entities.length,
    ...(parsed.count !== undefined ? { count: parsed.count } : {}),
    ...(parsed.capped !== undefined ? { capped: parsed.capped } : {}),
    reason: `brownfield-land: ${opportunities.length} usable site(s)`,
  };
}

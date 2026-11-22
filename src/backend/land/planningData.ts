import { Fetcher, type FetchOutcome } from "@backend/discovery/fetcher";
import {
  mapPlanningEntities,
  LAND_CONSTRAINT_DATASETS,
  type PlanningEntity,
} from "@shared/domain/land/planningConstraints";
import type { Constraint } from "@shared/domain/land/types";

/**
 * The planning.data.gov.uk connector — the free, licensed, keyless half of the
 * land finder's constraint checking.
 *
 * It reaches the one host the source is bound to, through the single sanctioned
 * outbound path (`Fetcher`, decision #39): licence gate, host allowlist, HTTPS,
 * robots, rate limit. No second outbound path. The response is mapped to LODE
 * constraints by the pure mapper; this file only fetches and parses.
 *
 * Not yet live-verified from this environment (egress is blocked in the build
 * sandbox), so the exact dataset names and response shape are confirmed against
 * one real request before relying on it — the same honest posture as the
 * Gazette and GoldMine connectors.
 */

const BASE = "https://www.planning.data.gov.uk/entity.json";

export interface PlanningConstraintsResult {
  readonly ok: boolean;
  readonly outcome: FetchOutcome;
  readonly constraints: readonly Constraint[];
  readonly designations: readonly string[];
  readonly allocation: boolean;
  readonly reason: string;
}

function entitiesFrom(body: string): readonly PlanningEntity[] {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed !== null && typeof parsed === "object" && Array.isArray((parsed as { entities?: unknown }).entities)) {
      return (parsed as { entities: PlanningEntity[] }).entities;
    }
    // Some endpoints return a bare array.
    if (Array.isArray(parsed)) return parsed as PlanningEntity[];
    return [];
  } catch {
    return [];
  }
}

function buildUrl(longitude: number, latitude: number): string {
  const params = new URLSearchParams();
  params.set("longitude", String(longitude));
  params.set("latitude", String(latitude));
  params.set("limit", "500");
  for (const d of LAND_CONSTRAINT_DATASETS) params.append("dataset", d);
  return `${BASE}?${params.toString()}`;
}

/**
 * Fetch the planning designations at a point and map them to constraints. A
 * fetch failure (no licence, host refused, network) returns no constraints with
 * the outcome and reason — never a guess, and never an invented "clear" result:
 * absence of data is unknown, not "no constraints" (a feed gap is unknown data).
 */
export async function fetchPlanningConstraints(
  fetcher: Fetcher,
  point: { readonly longitude: number; readonly latitude: number },
): Promise<PlanningConstraintsResult> {
  const result = await fetcher.get("planning-data", buildUrl(point.longitude, point.latitude));
  if (!result.ok || result.body === undefined) {
    return {
      ok: false,
      outcome: result.outcome,
      constraints: [],
      designations: [],
      allocation: false,
      reason: result.reason,
    };
  }

  const mapping = mapPlanningEntities(entitiesFrom(result.body));
  return {
    ok: true,
    outcome: "ok",
    constraints: mapping.constraints,
    designations: mapping.designations,
    allocation: mapping.allocation,
    reason: `planning.data.gov.uk: ${mapping.constraints.length} constraint(s), ${mapping.designations.length} designation(s)`,
  };
}

import { runFromArea, runFromCouncil, type AreaRunResult } from "@backend/discovery/sourcingRun";
import { saveSourcedProperty } from "@backend/store/repository";
import type { StoredSourcedProperty } from "@backend/store/schema";

/**
 * The hands-off weekly sweep.
 *
 * The single-postcode and council searches are operator-triggered; this runs
 * them on a schedule so the worklist refreshes itself and the operator opens the
 * sourcing page to a fresh, ranked shortlist with no clicks. It only ever writes
 * the property-fact leads (prepared-but-unsold) to the worklist — the distress
 * signals are never warehoused — and the store merges on the address key, so a
 * re-sweep keeps when a lead was first seen and does not un-dismiss anything a
 * person set aside. Nothing here contacts anyone: it finds and ranks; a named
 * person still decides and approaches by post.
 *
 * Pure orchestration with injectable dependencies, so the schedule, the runs and
 * the store can each be exercised without a network or a database.
 */

/** A full UK postcode routes to the exact search; anything else is a council. */
const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

/** A cron cannot sweep an unbounded number of areas in one invocation. */
export const MAX_SWEEP_AREAS = 25;

export interface SweepAreaResult {
  readonly area: string;
  readonly kind: "postcode" | "council";
  /** Prepared-but-unsold leads written to the worklist for this area. */
  readonly saved: number;
  readonly note: string;
}

export interface SweepResult {
  readonly areas: readonly SweepAreaResult[];
  readonly totalSaved: number;
  readonly ranAt: string;
}

export interface SweepDeps {
  readonly runArea?: (postcode: string) => Promise<AreaRunResult>;
  readonly runCouncil?: (council: string) => Promise<AreaRunResult>;
  readonly save?: (entry: StoredSourcedProperty) => Promise<unknown>;
  readonly now?: Date;
}

/**
 * Parse the configured areas (comma- or newline-separated), trimmed and bounded.
 * Blank or unset yields an empty list, which the caller reports rather than
 * treating as an error — a sweep with nothing to sweep is a no-op, not a fault.
 */
export function parseAreas(raw: string | undefined): readonly string[] {
  return (raw ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .slice(0, MAX_SWEEP_AREAS);
}

/**
 * Run each configured area and persist its prepared-but-unsold leads.
 *
 * Sequential on purpose: each area (a council especially) already fans out
 * across many Price Paid lookups, so running the areas themselves in parallel
 * would multiply the outbound load rather than bound it.
 */
export async function sweepAreas(areas: readonly string[], deps: SweepDeps = {}): Promise<SweepResult> {
  const iso = (deps.now ?? new Date()).toISOString();
  const runArea = deps.runArea ?? ((pc: string) => runFromArea(pc));
  const runCouncil = deps.runCouncil ?? ((c: string) => runFromCouncil(c));
  const save = deps.save ?? ((entry: StoredSourcedProperty) => saveSourcedProperty(entry));

  const results: SweepAreaResult[] = [];
  let totalSaved = 0;

  for (const area of areas) {
    const isPostcode = UK_POSTCODE.test(area);
    const run = isPostcode ? await runArea(area.toUpperCase()) : await runCouncil(area);

    let saved = 0;
    for (const lead of run.leads) {
      if (lead.signalKey !== "prepared-but-unsold" || lead.addressKey === undefined) continue;
      await save({ id: lead.addressKey, lead, firstSeenAt: iso, lastSeenAt: iso });
      saved += 1;
    }

    totalSaved += saved;
    results.push({ area, kind: isPostcode ? "postcode" : "council", saved, note: run.note });
  }

  return { areas: results, totalSaved, ranAt: iso };
}

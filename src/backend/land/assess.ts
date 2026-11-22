import { assessLandSite, type LandAssessment } from "@shared/domain/land/sourcing";
import { siteFromInput, type LandInput } from "@shared/domain/land/input";
import { enrichConstraints, planningFetcher } from "@backend/land/enrich";
import { geocodePostcode } from "@backend/land/geocode";
import type { Fetcher } from "@backend/discovery/fetcher";

/**
 * Assess a site a user is considering: parse what they typed, geocode the
 * postcode, pull the real planning designations for that point, and run the
 * engine. This is the useful-today path — the user brings the lead, LODE gives
 * the verdict.
 *
 * The assessment always runs on the declared inputs; the geocode + planning
 * enrichment only ever ADD constraints (green belt, flood zone, SSSI) found on
 * the national map. If either is unavailable, the verdict still stands on what
 * the user told us — it just says the live check could not be run, never a false
 * "all clear."
 */

export interface SiteAssessmentResult {
  readonly assessment?: LandAssessment;
  readonly errors: readonly string[];
  readonly notes: readonly string[];
  readonly planningChecked: boolean;
}

export async function assessSiteFromInput(
  raw: LandInput,
  // The outbound path is injectable so the chain is testable without a live
  // network; production uses the real planning-data Fetcher.
  fetcher: Fetcher = planningFetcher(),
): Promise<SiteAssessmentResult> {
  const parsed = siteFromInput(raw);
  if (parsed.errors.length > 0) {
    return { errors: parsed.errors, notes: [], planningChecked: false };
  }

  const notes: string[] = [];
  let site = parsed.site;
  let planningChecked = false;

  const geo = await geocodePostcode(fetcher, parsed.postcode);
  if (geo.ok && geo.longitude !== undefined && geo.latitude !== undefined) {
    const located = { ...site, location: { longitude: geo.longitude, latitude: geo.latitude } };
    const enriched = await enrichConstraints(located, fetcher);
    site = enriched.site;
    planningChecked = enriched.enriched;
    notes.push(enriched.enriched ? enriched.note : `Live planning check could not be run (${enriched.note}). Verdict uses what you entered.`);
  } else {
    notes.push(`Could not place the postcode on the map (${geo.reason}). Verdict uses what you entered — tick any designations you know of.`);
  }

  return { assessment: assessLandSite(site), errors: [], notes, planningChecked };
}

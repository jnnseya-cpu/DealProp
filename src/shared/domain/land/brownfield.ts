import type { LandSite, PlanningStatus } from "@shared/domain/land/types";

/**
 * Brownfield Land Registers → LODE land opportunities.
 *
 * Every English planning authority must publish, under the Open Government
 * Licence, a register of previously-developed ("brownfield") sites it judges
 * suitable for housing. The registers are aggregated nationally on the MHCLG
 * Planning Data platform as the `brownfield-land` dataset. Each record carries
 * what sourcing actually needs: where the site is, how big it is, the
 * authority's OWN minimum/maximum dwelling capacity, the planning-permission
 * status and who broadly owns it.
 *
 * This is the lawful, free answer to "find me development sites" — not scraping
 * a portal (decision #14), but reading a public register of SITES (never
 * personal data about a named person). This module is the pure half: it maps a
 * register entity to a LandOpportunity and bridges it into the existing
 * assessment engine. The backend connector does the fetch.
 *
 * A figure LODE did not compute carries its provenance (decision #6, and the
 * Coxford Road lesson): the register's dwelling capacity is the LPA's own
 * estimate and is shown AS the register's, kept distinct from the engine's
 * indicative density figure.
 */

export const BROWNFIELD_VERSION = "brownfield-1";

/** One `brownfield-land` entity as the Planning Data entity API returns it. */
export interface BrownfieldEntity {
  readonly reference?: string;
  readonly name?: string;
  /** The real, human site label, e.g. "Glendaragh, Barn Park Road, Teignmouth TQ14 8PN". */
  readonly "site-address"?: string;
  /** The publishing authority's Planning Data entity id (a number, not a name). */
  readonly "organisation-entity"?: string | number;
  /** WKT point, e.g. "POINT (-1.56 52.34)". */
  readonly point?: string;
  readonly hectares?: string | number;
  /** Hyphenated controlled vocabulary, e.g. "not-owned-by-a-public-authority". */
  readonly "ownership-status"?: string;
  readonly "minimum-net-dwellings"?: string | number;
  readonly "maximum-net-dwellings"?: string | number;
  /** Hyphenated, e.g. "permissioned" | "not-permissioned" | "pending-decision". */
  readonly "planning-permission-status"?: string;
  /** Hyphenated, e.g. "full-planning-permission" | "outline-planning-permission". */
  readonly "planning-permission-type"?: string;
  readonly deliverable?: string;
  readonly "site-plan-url"?: string;
  readonly "entry-date"?: string;
  readonly [key: string]: unknown;
}

/**
 * Which national register a site came from. "brownfield" is previously-developed
 * land suitable for housing (mostly consented, to buy); "allocation" is a local-
 * plan housing/site allocation (mostly unconsented — the option/promotion end).
 * The two share this model and the same assessment engine; only the label and
 * the dataset queried differ.
 */
export type LandKind = "brownfield" | "allocation";

/** A normalised development-land opportunity sourced from a planning register. */
export interface LandOpportunity {
  readonly id: string;
  readonly reference: string;
  /** Which register it came from. */
  readonly kind: LandKind;
  /** The site address where the register gives one, else its name/reference. */
  readonly name: string;
  /** Postcode parsed from the site address, where present. */
  readonly postcode?: string;
  readonly location?: { readonly longitude: number; readonly latitude: number };
  readonly areaHectares: number;
  /** The authority's own capacity estimate — shown as the register's figure. */
  readonly minUnits?: number;
  readonly maxUnits?: number;
  readonly planningStatus: PlanningStatus;
  /** True where the register records a public authority owns it. */
  readonly ownershipPublic: boolean;
  readonly deliverable?: boolean;
  /** The publishing authority's Planning Data entity id (a number, not a name). */
  readonly organisationEntity?: number;
  readonly asOf: string;
  readonly sitePlanUrl?: string;
}

function numberFrom(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Parse a WKT "POINT (lng lat)" into coordinates. */
export function parseWktPoint(wkt: string | undefined): { longitude: number; latitude: number } | undefined {
  if (typeof wkt !== "string") return undefined;
  const m = /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i.exec(wkt);
  if (m === null) return undefined;
  const longitude = Number(m[1]);
  const latitude = Number(m[2]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return undefined;
  return { longitude, latitude };
}

/**
 * Map the register's planning-permission fields to a LODE PlanningStatus. The
 * register states a status ("permissioned" / "not permissioned" / "pending
 * decision") and, where permissioned, a type ("full" / "outline" / "permission
 * in principle"). Unknown or absent is `none`, never a guessed consent
 * (decision #5: unknown defaults to the cautious value, never the permissive).
 */
export function mapBrownfieldPlanning(status: string | undefined, type: string | undefined): PlanningStatus {
  // The register hyphenates its values ("not-permissioned", "full-planning-
  // permission"), so normalise hyphens to spaces before matching — otherwise
  // "not-permissioned" slips past a "not " guard and reads as consented.
  const t = (type ?? "").toLowerCase().replace(/-/g, " ");
  const s = (status ?? "").toLowerCase().replace(/-/g, " ");
  if (t.includes("full")) return "full";
  if (t.includes("reserved")) return "reserved-matters";
  if (t.includes("outline")) return "outline";
  if (t.includes("principle")) return "outline";
  // Check the negatives before the bare "permission" test.
  if (s.includes("not permission")) return "none";
  if (s.includes("pending")) return "pre-application";
  if (s.includes("permission")) return "outline"; // permissioned but type unstated
  return "none";
}

/** A persisted opportunity with its sourceability score precomputed for ranking. */
export interface StoredBrownfieldSite {
  readonly opportunity: LandOpportunity;
  /** The assessment's sourceability score, stored so the store can rank without domain logic. */
  readonly score: number;
}

/** The postcode area (leading letters) of an opportunity, for store indexing. */
export function postcodeAreaOf(postcode: string | undefined): string {
  if (typeof postcode !== "string") return "";
  return /^[A-Za-z]+/.exec(postcode.trim())?.[0]?.toUpperCase() ?? "";
}

/** Parse a trailing UK postcode from a site address, normalised with one space. */
export function postcodeFromAddress(address: string | undefined): string | undefined {
  if (typeof address !== "string") return undefined;
  const m = /([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\s*$/i.exec(address.trim());
  const found = m?.[1];
  if (found === undefined) return undefined;
  const raw = found.toUpperCase().replace(/\s+/g, "");
  return `${raw.slice(0, -3)} ${raw.slice(-3)}`;
}

function isConsented(status: PlanningStatus): boolean {
  return status === "outline" || status === "reserved-matters" || status === "full";
}

/**
 * Map a register entity to a LandOpportunity, or undefined when it lacks the
 * minimum a sourcing record needs (a reference and a positive site area). A
 * record with no usable area cannot be assessed, so it is dropped rather than
 * shown as a zero-area site.
 */
export function mapBrownfieldEntity(entity: BrownfieldEntity, kind: LandKind = "brownfield"): LandOpportunity | undefined {
  const reference = typeof entity.reference === "string" && entity.reference.trim() !== "" ? entity.reference.trim() : undefined;
  const hectares = numberFrom(entity.hectares);
  if (reference === undefined || hectares === undefined || hectares <= 0) return undefined;

  // The register hyphenates ownership ("not-owned-by-a-public-authority"), which
  // contains "public"; normalise hyphens and exclude the negative phrase, or a
  // privately-owned site is mislabelled as public (confirmed against real data).
  const ownership = (entity["ownership-status"] ?? "").toString().toLowerCase().replace(/-/g, " ");
  const ownershipPublic = !ownership.includes("not ") && (ownership.includes("public") || ownership.includes("local authority"));

  const deliverableRaw = (entity.deliverable ?? "").toString().toLowerCase();
  const minUnits = numberFrom(entity["minimum-net-dwellings"]);
  const maxUnits = numberFrom(entity["maximum-net-dwellings"]);
  const point = parseWktPoint(entity.point);
  const address = typeof entity["site-address"] === "string" && entity["site-address"].trim() !== "" ? entity["site-address"].trim() : undefined;
  const postcode = postcodeFromAddress(address);
  const orgEntity = numberFrom(entity["organisation-entity"]);
  const name = address ?? (typeof entity.name === "string" && entity.name.trim() !== "" ? entity.name.trim() : reference);

  // An allocation with no recorded consent is "allocated" in the plan, not
  // "none" — which is exactly the option / conditional / promotion end.
  const mappedPlanning = mapBrownfieldPlanning(entity["planning-permission-status"], entity["planning-permission-type"]);
  const planningStatus = kind === "allocation" && mappedPlanning === "none" ? "allocated" : mappedPlanning;

  return {
    id: reference,
    reference,
    kind,
    name,
    ...(postcode !== undefined ? { postcode } : {}),
    ...(point !== undefined ? { location: point } : {}),
    areaHectares: Math.round(hectares * 100) / 100,
    ...(minUnits !== undefined ? { minUnits: Math.round(minUnits) } : {}),
    ...(maxUnits !== undefined ? { maxUnits: Math.round(maxUnits) } : {}),
    planningStatus,
    ownershipPublic,
    ...(deliverableRaw === "yes" || deliverableRaw === "true" ? { deliverable: true } : deliverableRaw === "no" || deliverableRaw === "false" ? { deliverable: false } : {}),
    ...(orgEntity !== undefined ? { organisationEntity: orgEntity } : {}),
    asOf: typeof entity["entry-date"] === "string" ? entity["entry-date"] : "",
    ...(typeof entity["site-plan-url"] === "string" && entity["site-plan-url"].trim() !== "" ? { sitePlanUrl: entity["site-plan-url"].trim() } : {}),
  };
}

/**
 * Bridge an opportunity into a LandSite so the existing assessment engine runs
 * on it. The register's capacity is authoritative where a consent exists, so a
 * consented site carries its max-net-dwellings as the consented count; an
 * unconsented one is left to the engine's indicative density. Brownfield land is
 * previously-developed and, by definition of the register, within a settlement,
 * so it is treated as suburban context — a documented default, not a guess
 * dressed as a fact. Constraints start empty and are added by the planning-map
 * enrichment exactly as for a user-entered site.
 */
export function opportunityToLandSite(opp: LandOpportunity): LandSite {
  return {
    id: opp.id,
    postcodeArea: opp.postcode !== undefined ? (/^[A-Za-z]+/.exec(opp.postcode)?.[0]?.toUpperCase() ?? "") : "",
    locality: opp.name,
    ...(opp.location !== undefined ? { location: opp.location } : {}),
    areaHectares: opp.areaHectares,
    // A brownfield register site is previously-developed land in a settlement
    // (suburban); a plan allocation is typically edge-of-settlement land being
    // brought forward — a documented default, not a guessed fact.
    currentUse: opp.kind === "allocation" ? "vacant" : "brownfield",
    settlement: opp.kind === "allocation" ? "edge-of-settlement" : "suburban",
    planningStatus: opp.planningStatus,
    ...(isConsented(opp.planningStatus) && opp.maxUnits !== undefined ? { consentedUnits: opp.maxUnits } : {}),
    constraints: [],
    // The register records ownership category; a public-authority site has a
    // known, reachable owner (the council), which the deliverability score uses.
    ownerKnown: opp.ownershipPublic,
    openlyMarketed: false,
  };
}

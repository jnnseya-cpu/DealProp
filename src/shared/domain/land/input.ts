import type {
  Constraint,
  ConstraintCode,
  CurrentUse,
  LandSite,
  PlanningStatus,
  SettlementType,
} from "@shared/domain/land/types";

/**
 * Turn a user's description of a site they are considering into a LandSite the
 * engine can assess.
 *
 * This is the "paste a site, get a verdict" path — the one that is useful to a
 * LODE user today, without a parcel feed or anyone's ownership data. The user
 * brings the lead (an address they drove past, a plot an agent mentioned); this
 * coerces what they typed into the model, applying safe defaults and reporting
 * what was missing, so the assessment is honest about its inputs.
 *
 * Pure and fully tested. The backend adds the free geocode + planning-constraint
 * enrichment on top; this is just the parse.
 */

const ACRE_TO_HECTARE = 0.404686;

const USES: readonly CurrentUse[] = ["brownfield", "agricultural", "paddock", "garden", "employment", "vacant"];
const SETTLEMENTS: readonly SettlementType[] = ["urban", "suburban", "edge-of-settlement", "rural"];
const STATUSES: readonly PlanningStatus[] = [
  "none",
  "pre-application",
  "allocated",
  "outline",
  "reserved-matters",
  "full",
  "lapsed",
  "refused",
];

/** Constraints a user can declare up front, with the severity LODE applies. */
export const DECLARABLE_CONSTRAINTS: Record<string, { code: ConstraintCode; severity: "hard" | "soft"; label: string }> = {
  "green-belt": { code: "green-belt", severity: "hard", label: "Green belt" },
  "flood-zone-3": { code: "flood-zone-3", severity: "hard", label: "Flood zone 3" },
  "flood-zone-2": { code: "flood-zone-2", severity: "soft", label: "Flood zone 2" },
  "conservation-area": { code: "conservation-area", severity: "soft", label: "Conservation area" },
  "listed-building": { code: "listed-building", severity: "soft", label: "Listed building on/near" },
  aonb: { code: "aonb", severity: "soft", label: "AONB" },
  "no-access": { code: "no-access", severity: "hard", label: "No road access" },
};

export interface LandInput {
  readonly postcode?: string;
  readonly locality?: string;
  readonly acres?: string;
  readonly use?: string;
  readonly settlement?: string;
  readonly planning?: string;
  readonly units?: string;
  /** Constraint keys the user ticked (keys of DECLARABLE_CONSTRAINTS). */
  readonly constraints?: readonly string[];
}

export interface ParsedLandInput {
  readonly site: LandSite;
  /** The full postcode as entered, for geocoding (LandSite keeps only the area). */
  readonly postcode: string;
  readonly errors: readonly string[];
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** The leading letters of a UK postcode: "B29 6AD" → "B", "CV8 1AA" → "CV". */
export function postcodeArea(postcode: string): string {
  const m = /^[A-Za-z]+/.exec(postcode.trim());
  return m ? m[0].toUpperCase() : "";
}

export function siteFromInput(raw: LandInput): ParsedLandInput {
  const errors: string[] = [];

  const postcode = (raw.postcode ?? "").trim();
  if (postcode === "") errors.push("Enter the postcode of the site.");

  const acres = Number(raw.acres);
  if (!Number.isFinite(acres) || acres <= 0) errors.push("Enter the site size in acres.");

  const use = pick(raw.use, USES, "agricultural");
  const settlement = pick(raw.settlement, SETTLEMENTS, "edge-of-settlement");
  const planning = pick(raw.planning, STATUSES, "none");

  const areaHectares = Number.isFinite(acres) && acres > 0 ? Math.round(acres * ACRE_TO_HECTARE * 100) / 100 : 0;

  const unitsNum = raw.units !== undefined && raw.units !== "" ? Number(raw.units) : undefined;
  const consentedUnits = unitsNum !== undefined && Number.isFinite(unitsNum) && unitsNum > 0 ? Math.round(unitsNum) : undefined;

  const constraints: Constraint[] = (raw.constraints ?? [])
    .map((key) => DECLARABLE_CONSTRAINTS[key])
    .filter((c): c is (typeof DECLARABLE_CONSTRAINTS)[string] => c !== undefined)
    .map((c) => ({ code: c.code, severity: c.severity }));

  const site: LandSite = {
    id: "assessed-input",
    postcodeArea: postcodeArea(postcode),
    locality: (raw.locality ?? "").trim() || postcode,
    areaHectares,
    currentUse: use,
    settlement,
    planningStatus: planning,
    ...(consentedUnits !== undefined ? { consentedUnits } : {}),
    constraints,
    // A user's own lead: they can reach the owner themselves, and it isn't
    // "openly marketed" on a portal — so the route defaults to owner approach
    // unless the site is consented.
    ownerKnown: false,
    openlyMarketed: false,
  };

  return { site, postcode, errors };
}

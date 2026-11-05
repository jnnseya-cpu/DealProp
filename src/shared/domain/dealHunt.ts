import type { Money } from "@shared/money";

/**
 * The Deal Hunt search-criteria contract (spec §2).
 *
 * An investor's brief ("2–3 bed houses in Birmingham under £225k that returned
 * to market in the last 30 days and dropped 5%") becomes these typed criteria.
 * The model proposes them; this validates. A live hunt requires a geography and
 * a price ceiling (DH02); defaults are proposed visibly, not assumed silently;
 * contradictions and unsupported requests are blocked. Editing criteria is a
 * new immutable revision — enforced by the store, not here.
 *
 * Integer pence and basis points throughout, like the rest of the platform.
 */

export const DEAL_HUNT_SCHEMA_VERSION = "1.0";

export type PriceOperator = "lt" | "lte";
export type EventRequirement = "returned_to_market" | "confirmed_fall_through";
export type PriceBaseline = "before_under_offer";
export type EvidenceSection = "sold" | "rent";

export interface DealHuntCriteria {
  readonly schemaVersion: string;
  readonly geographyId: string;
  readonly propertyTypes: readonly string[];
  readonly bedroomsMin?: number;
  readonly bedroomsMax?: number;
  readonly askingPriceLimitPence: Money;
  readonly priceOperator: PriceOperator;
  readonly returnedWithinDays: number;
  readonly eventRequirement: EventRequirement;
  readonly priceBaseline: PriceBaseline;
  readonly minimumDropBps: number;
  readonly evidenceSections: readonly EvidenceSection[];
  readonly resultLimit: number;
}

export const DEAL_HUNT_DEFAULTS = {
  returnedWithinDays: 30,
  minimumDropBps: 0,
  resultLimit: 20,
  priceOperator: "lt" as PriceOperator,
  eventRequirement: "returned_to_market" as EventRequirement,
  priceBaseline: "before_under_offer" as PriceBaseline,
  evidenceSections: ["sold", "rent"] as readonly EvidenceSection[],
} as const;

export const DEAL_HUNT_RESULT_CAP = 50;
const MAX_RETURN_DAYS = 365;
const MAX_BPS = 10_000;

export interface CriteriaDraft {
  readonly geographyId?: string;
  readonly propertyTypes?: readonly string[];
  readonly bedroomsMin?: number;
  readonly bedroomsMax?: number;
  readonly askingPriceLimitPence?: number;
  readonly priceOperator?: PriceOperator;
  readonly returnedWithinDays?: number;
  readonly eventRequirement?: EventRequirement;
  readonly priceBaseline?: PriceBaseline;
  readonly minimumDropBps?: number;
  readonly evidenceSections?: readonly EvidenceSection[];
  readonly resultLimit?: number;
}

export type CriteriaValidation =
  | { readonly ok: true; readonly criteria: DealHuntCriteria }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Validate a draft into live criteria, applying the visible defaults. A live
 * hunt needs a geography and a price ceiling; anything out of range, or
 * contradictory, is refused rather than coerced (DH02).
 */
export function validateCriteria(draft: CriteriaDraft): CriteriaValidation {
  const errors: string[] = [];

  const geographyId = (draft.geographyId ?? "").trim();
  if (geographyId === "") errors.push("A geography is required — resolve the area before running a hunt.");

  const price = draft.askingPriceLimitPence;
  if (price === undefined || !Number.isInteger(price) || price <= 0) {
    errors.push("A price ceiling is required, as a positive integer of pence.");
  }

  const returnedWithinDays = draft.returnedWithinDays ?? DEAL_HUNT_DEFAULTS.returnedWithinDays;
  if (!Number.isInteger(returnedWithinDays) || returnedWithinDays < 1 || returnedWithinDays > MAX_RETURN_DAYS) {
    errors.push(`The return window must be a whole number of days from 1 to ${MAX_RETURN_DAYS}.`);
  }

  const minimumDropBps = draft.minimumDropBps ?? DEAL_HUNT_DEFAULTS.minimumDropBps;
  if (!Number.isInteger(minimumDropBps) || minimumDropBps < 0 || minimumDropBps > MAX_BPS) {
    errors.push(`The minimum drop must be from 0 to ${MAX_BPS} basis points.`);
  }

  const resultLimit = draft.resultLimit ?? DEAL_HUNT_DEFAULTS.resultLimit;
  if (!Number.isInteger(resultLimit) || resultLimit < 1 || resultLimit > DEAL_HUNT_RESULT_CAP) {
    errors.push(`The result limit must be from 1 to ${DEAL_HUNT_RESULT_CAP}.`);
  }

  if (
    draft.bedroomsMin !== undefined &&
    draft.bedroomsMax !== undefined &&
    draft.bedroomsMin > draft.bedroomsMax
  ) {
    errors.push("The minimum bedrooms cannot exceed the maximum.");
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    criteria: {
      schemaVersion: DEAL_HUNT_SCHEMA_VERSION,
      geographyId,
      propertyTypes: draft.propertyTypes ?? [],
      ...(draft.bedroomsMin !== undefined ? { bedroomsMin: draft.bedroomsMin } : {}),
      ...(draft.bedroomsMax !== undefined ? { bedroomsMax: draft.bedroomsMax } : {}),
      askingPriceLimitPence: price as Money,
      priceOperator: draft.priceOperator ?? DEAL_HUNT_DEFAULTS.priceOperator,
      returnedWithinDays,
      eventRequirement: draft.eventRequirement ?? DEAL_HUNT_DEFAULTS.eventRequirement,
      priceBaseline: draft.priceBaseline ?? DEAL_HUNT_DEFAULTS.priceBaseline,
      minimumDropBps,
      evidenceSections: draft.evidenceSections ?? DEAL_HUNT_DEFAULTS.evidenceSections,
      resultLimit,
    },
  };
}

/** True where the current asking price satisfies the ceiling, by its operator. */
export function withinPriceCeiling(currentPence: Money, criteria: DealHuntCriteria): boolean {
  return criteria.priceOperator === "lt"
    ? currentPence < criteria.askingPriceLimitPence
    : currentPence <= criteria.askingPriceLimitPence;
}

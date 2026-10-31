import {
  checkbox,
  requireManyOf,
  requireOneOf,
  requiredInteger,
  requiredMoney,
  requiredPercent,
  requiredText,
  textList,
} from "@shared/formFields";
import { returnCapFor, withinReturnCap, type FunderKind, type FundingBox } from "@shared/domain/matching";
import type { JurisdictionCode, PropertyType } from "@shared/domain/types";

/**
 * The Funding Box criteria from a form, minus identity, ownership and the
 * verification Lode records separately.
 *
 * Shared by the save action and the public preview, so the two cannot diverge.
 * Strict and total, with the cross-field checks that a single value cannot
 * express: an inverted ticket or term range matches nothing, a fund that cannot
 * write its own smallest cheque matches nothing, and a required return above
 * the platform cap is refused outright.
 */
const JURISDICTIONS = new Set<string>(["GB-ENG", "GB-SCT", "GB-WLS", "GB-NIR", "US-GEN"]);
const PROPERTY_TYPES = new Set<string>([
  "house",
  "flat",
  "bungalow",
  "hmo",
  "commercial",
  "mixed-use",
  "land",
]);
const FUNDER_KINDS = new Set<string>([
  "bridging-lender",
  "private-lender",
  "family-office",
  "debt-fund",
  "jv-equity-partner",
  "development-lender",
]);

export type FundingBoxFields = Omit<FundingBox, "id" | "ownerAccountId" | "verification">;

export function parseFundingBoxFields(formData: FormData): FundingBoxFields {
  const minTicket = requiredMoney(formData.get("minTicket"), "Minimum ticket");
  const maxTicket = requiredMoney(formData.get("maxTicket"), "Maximum ticket");
  if (maxTicket < minTicket) throw new Error("Maximum ticket must be at or above the minimum ticket");

  const capitalAvailable = requiredMoney(formData.get("capitalAvailable"), "Capital available");
  if (capitalAvailable < minTicket) {
    throw new Error("Capital available cannot be less than the minimum ticket");
  }

  const minTermMonths = requiredInteger(formData.get("minTermMonths"), "Minimum term", { min: 1, max: 360 });
  const maxTermMonths = requiredInteger(formData.get("maxTermMonths"), "Maximum term", { min: 1, max: 360 });
  if (maxTermMonths < minTermMonths) throw new Error("Maximum term must be at or above the minimum term");

  const flip = {
    acceptsRefurbishment: checkbox(formData.get("acceptsRefurbishment")),
    acceptsDevelopment: checkbox(formData.get("acceptsDevelopment")),
  };
  const requiredReturnBps = requiredPercent(formData.get("requiredReturn"), "Required return");
  if (!withinReturnCap(requiredReturnBps, flip)) {
    throw new Error(`Required return must be no more than ${returnCapFor(flip) / 100}% a year`);
  }

  return {
    funderName: requiredText(formData.get("funderName"), "Lender name"),
    kind: requireOneOf<FunderKind>(formData.get("kind"), FUNDER_KINDS, "funder kind"),
    jurisdictions: requireManyOf<JurisdictionCode>(formData.getAll("jurisdictions"), JURISDICTIONS, "jurisdiction"),
    localities: textList(formData.get("localities")),
    capitalAvailable,
    minTicket,
    maxTicket,
    propertyTypes: requireManyOf<PropertyType>(formData.getAll("propertyTypes"), PROPERTY_TYPES, "property type"),
    maxLtvBps: requiredPercent(formData.get("maxLtv"), "Maximum LTV"),
    minTermMonths,
    maxTermMonths,
    acceptsRefurbishment: flip.acceptsRefurbishment,
    acceptsDevelopment: flip.acceptsDevelopment,
    requiresFirstCharge: checkbox(formData.get("requiresFirstCharge")),
    minBorrowerCompletedDeals: requiredInteger(formData.get("minBorrowerCompletedDeals"), "Minimum completed deals", {
      min: 0,
      max: 100,
    }),
    requiredReturnBps,
    personalGuaranteeRequired: checkbox(formData.get("personalGuaranteeRequired")),
    active: checkbox(formData.get("active")),
  };
}

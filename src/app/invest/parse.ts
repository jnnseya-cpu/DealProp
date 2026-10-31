import {
  checkbox,
  requireManyOf,
  requiredInteger,
  requiredMoney,
  requiredPercent,
  requiredText,
  textList,
} from "@shared/formFields";
import type { BuyBox } from "@shared/domain/matching";
import { ALL_STRUCTURES } from "@shared/domain/strategies";
import type { JurisdictionCode, PropertyType, StructureKind } from "@shared/domain/types";

/**
 * The Buy Box criteria from a form, minus identity and ownership.
 *
 * Shared by the save action and the public preview so the two cannot diverge —
 * a field the preview parsed more loosely than the save would let a guest see
 * matches against criteria they could never actually store. Strict and total:
 * anything unrecognised throws rather than defaulting, because an inverted or
 * silently-defaulted range matches nothing and reads as "no deals available".
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
const STRUCTURES = new Set<string>(ALL_STRUCTURES);

export type BuyBoxFields = Omit<BuyBox, "id" | "ownerAccountId">;

export function parseBuyBoxFields(formData: FormData): BuyBoxFields {
  const minPrice = requiredMoney(formData.get("minPrice"), "Minimum price");
  const maxPrice = requiredMoney(formData.get("maxPrice"), "Maximum price");
  if (maxPrice < minPrice) {
    throw new Error("Maximum price must be at or above the minimum price");
  }
  return {
    investorName: requiredText(formData.get("investorName"), "Investor name"),
    jurisdictions: requireManyOf<JurisdictionCode>(
      formData.getAll("jurisdictions"),
      JURISDICTIONS,
      "jurisdiction",
    ),
    localities: textList(formData.get("localities")),
    propertyTypes: requireManyOf<PropertyType>(
      formData.getAll("propertyTypes"),
      PROPERTY_TYPES,
      "property type",
    ),
    minPrice,
    maxPrice,
    minBedrooms: requiredInteger(formData.get("minBedrooms"), "Minimum bedrooms", { min: 0, max: 20 }),
    minMarginBps: requiredPercent(formData.get("minMargin"), "Minimum margin"),
    maxRefurbishment: requiredMoney(formData.get("maxRefurbishment"), "Maximum refurbishment"),
    acceptsRefurbishment: checkbox(formData.get("acceptsRefurbishment")),
    minYieldBps: requiredPercent(formData.get("minYield"), "Minimum yield"),
    maxCompletionDays: requiredInteger(formData.get("maxCompletionDays"), "Maximum completion days", {
      min: 1,
      max: 365,
    }),
    acceptableStructures: requireManyOf<StructureKind>(
      formData.getAll("acceptableStructures"),
      STRUCTURES,
      "structure",
    ),
    minDealScore: requiredInteger(formData.get("minDealScore"), "Minimum Deal Score", { min: 0, max: 100 }),
    active: checkbox(formData.get("active")),
  };
}

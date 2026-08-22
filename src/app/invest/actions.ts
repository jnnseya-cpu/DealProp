"use server";

import { revalidatePath } from "next/cache";
import { newToken } from "@backend/auth/tokens";
import {
  checkbox,
  type BoxFormResult,
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
import { deleteBuyBox, getBuyBox, saveBuyBox } from "@backend/store/repository";

/**
 * Buy Box mandates.
 *
 * A mandate is not a wish list. `countInterestedBuyers()` reads these records
 * to tell a seller how many buyers exist for their property, so anything saved
 * here becomes a statement made to a member of the public. That is why the
 * parsing is strict, why min/max pairs are checked against each other rather
 * than stored as given, and why deactivating is offered alongside deleting: a
 * funder who is temporarily out of the market should stop appearing in that
 * count without their criteria being lost.
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

export async function saveBuyBoxAction(
  _previous: BoxFormResult | undefined,
  formData: FormData,
): Promise<BoxFormResult> {
  try {
    const minPrice = requiredMoney(formData.get("minPrice"), "Minimum price");
    const maxPrice = requiredMoney(formData.get("maxPrice"), "Maximum price");
    if (maxPrice < minPrice) {
      // Checked here rather than trusted from the form, because an inverted
      // range silently matches nothing and looks like "no deals available".
      throw new Error("Maximum price must be at or above the minimum price");
    }

    const id = idFrom(formData.get("id"));
    const existing = id !== undefined ? await getBuyBox(id) : undefined;

    const box: BuyBox = {
      id: existing?.id ?? `buy-${newToken()}`,
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
      minBedrooms: requiredInteger(formData.get("minBedrooms"), "Minimum bedrooms", {
        min: 0,
        max: 20,
      }),
      minMarginBps: requiredPercent(formData.get("minMargin"), "Minimum margin"),
      maxRefurbishment: requiredMoney(formData.get("maxRefurbishment"), "Maximum refurbishment"),
      acceptsRefurbishment: checkbox(formData.get("acceptsRefurbishment")),
      minYieldBps: requiredPercent(formData.get("minYield"), "Minimum yield"),
      maxCompletionDays: requiredInteger(
        formData.get("maxCompletionDays"),
        "Maximum completion days",
        { min: 1, max: 365 },
      ),
      acceptableStructures: requireManyOf<StructureKind>(
        formData.getAll("acceptableStructures"),
        STRUCTURES,
        "structure",
      ),
      minDealScore: requiredInteger(formData.get("minDealScore"), "Minimum Deal Score", {
        min: 0,
        max: 100,
      }),
      active: checkbox(formData.get("active")),
    };

    await saveBuyBox(box);
    revalidatePath("/invest");
    return {
      ok: true,
      message:
        existing === undefined
          ? `Mandate created for ${box.investorName}.`
          : `Mandate updated for ${box.investorName}.`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save." };
  }
}

/** Stops appearing to sellers without losing the criteria. */
export async function setBuyBoxActive(id: string, active: boolean): Promise<void> {
  const box = await getBuyBox(id);
  if (box === undefined) return;
  await saveBuyBox({ ...box, active });
  revalidatePath("/invest");
}

export async function removeBuyBox(id: string): Promise<void> {
  await deleteBuyBox(id);
  revalidatePath("/invest");
}

function idFrom(raw: FormDataEntryValue | null): string | undefined {
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

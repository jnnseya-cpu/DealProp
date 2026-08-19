"use server";

import { revalidatePath } from "next/cache";
import { newToken } from "@/lib/tokens";
import {
  checkbox,
  type BoxFormResult,
  requireManyOf,
  requireOneOf,
  requiredInteger,
  requiredMoney,
  requiredPercent,
  requiredText,
  textList,
} from "@/lib/formFields";
import type { FunderKind, FundingBox } from "@/domain/matching";
import type { JurisdictionCode, PropertyType } from "@/domain/types";
import { deleteFundingBox, getFundingBox, saveFundingBox } from "@/store/repository";

/**
 * Funding Box mandates.
 *
 * The mirror of the Buy Box: what a lender or equity partner will fund, on
 * what terms, against which security. `matchFundingBox()` reads these to decide
 * which deals a funder is shown, so a wrong figure here does not produce an
 * error — it produces silence, and silence looks like "no capital available".
 * Ranges are therefore validated against each other rather than stored as
 * typed.
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

export async function saveFundingBoxAction(
  _previous: BoxFormResult | undefined,
  formData: FormData,
): Promise<BoxFormResult> {
  try {
    const minTicket = requiredMoney(formData.get("minTicket"), "Minimum ticket");
    const maxTicket = requiredMoney(formData.get("maxTicket"), "Maximum ticket");
    if (maxTicket < minTicket) {
      throw new Error("Maximum ticket must be at or above the minimum ticket");
    }

    const capitalAvailable = requiredMoney(formData.get("capitalAvailable"), "Capital available");
    if (capitalAvailable < minTicket) {
      // A fund that cannot write its own smallest cheque matches nothing, which
      // is indistinguishable from having no mandate at all.
      throw new Error("Capital available cannot be less than the minimum ticket");
    }

    const minTermMonths = requiredInteger(formData.get("minTermMonths"), "Minimum term", {
      min: 1,
      max: 360,
    });
    const maxTermMonths = requiredInteger(formData.get("maxTermMonths"), "Maximum term", {
      min: 1,
      max: 360,
    });
    if (maxTermMonths < minTermMonths) {
      throw new Error("Maximum term must be at or above the minimum term");
    }

    const id = idFrom(formData.get("id"));
    const existing = id !== undefined ? await getFundingBox(id) : undefined;

    const box: FundingBox = {
      id: existing?.id ?? `fund-${newToken()}`,
      funderName: requiredText(formData.get("funderName"), "Funder name"),
      kind: requireOneOf<FunderKind>(formData.get("kind"), FUNDER_KINDS, "funder kind"),
      jurisdictions: requireManyOf<JurisdictionCode>(
        formData.getAll("jurisdictions"),
        JURISDICTIONS,
        "jurisdiction",
      ),
      localities: textList(formData.get("localities")),
      capitalAvailable,
      minTicket,
      maxTicket,
      propertyTypes: requireManyOf<PropertyType>(
        formData.getAll("propertyTypes"),
        PROPERTY_TYPES,
        "property type",
      ),
      maxLtvBps: requiredPercent(formData.get("maxLtv"), "Maximum LTV"),
      minTermMonths,
      maxTermMonths,
      acceptsRefurbishment: checkbox(formData.get("acceptsRefurbishment")),
      acceptsDevelopment: checkbox(formData.get("acceptsDevelopment")),
      requiresFirstCharge: checkbox(formData.get("requiresFirstCharge")),
      minBorrowerCompletedDeals: requiredInteger(
        formData.get("minBorrowerCompletedDeals"),
        "Minimum completed deals",
        { min: 0, max: 100 },
      ),
      requiredReturnBps: requiredPercent(formData.get("requiredReturn"), "Required return"),
      personalGuaranteeRequired: checkbox(formData.get("personalGuaranteeRequired")),
      active: checkbox(formData.get("active")),
    };

    await saveFundingBox(box);
    revalidatePath("/capital");
    return {
      ok: true,
      message:
        existing === undefined
          ? `Mandate created for ${box.funderName}.`
          : `Mandate updated for ${box.funderName}.`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save." };
  }
}

export async function setFundingBoxActive(id: string, active: boolean): Promise<void> {
  const box = await getFundingBox(id);
  if (box === undefined) return;
  await saveFundingBox({ ...box, active });
  revalidatePath("/capital");
}

export async function removeFundingBox(id: string): Promise<void> {
  await deleteFundingBox(id);
  revalidatePath("/capital");
}

function idFrom(raw: FormDataEntryValue | null): string | undefined {
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

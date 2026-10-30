"use server";

import { revalidatePath } from "next/cache";
import { newToken } from "@backend/auth/tokens";
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
} from "@shared/formFields";
import { returnCapFor, withinReturnCap, type FunderKind, type FundingBox } from "@shared/domain/matching";
import type { JurisdictionCode, PropertyType } from "@shared/domain/types";
import {
  deleteFundingBox,
  getFundingBox,
  listFundingBoxes,
  saveFundingBox,
} from "@backend/store/repository";
import { requireMandateManagement, viewerAccount } from "@/app/operator/guard";
import { canManageMandate } from "@shared/domain/accounts";
import { entitlementsForAccount } from "@backend/billing/entitlement";
import { withinLimit } from "@shared/domain/entitlements";

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

/**
 * Every action here checks its own permission, for the reasons set out on the
 * Buy Box actions: a server action is its own POST endpoint, and a mandate is
 * both a paid entitlement and a statement of capital availability shown to
 * sellers.
 */
export async function saveFundingBoxAction(
  _previous: BoxFormResult | undefined,
  formData: FormData,
): Promise<BoxFormResult> {
  const viewer = await requireMandateManagement("/capital");

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

    // Flip appetite decides the cap, so it is read before the rate is checked.
    const flip = {
      acceptsRefurbishment: checkbox(formData.get("acceptsRefurbishment")),
      acceptsDevelopment: checkbox(formData.get("acceptsDevelopment")),
    };
    const requiredReturnBps = requiredPercent(formData.get("requiredReturn"), "Required return");
    if (!withinReturnCap(requiredReturnBps, flip)) {
      // The platform caps the cost of capital it will list. Above the cap the
      // mandate is refused rather than stored — Lode does not carry capital
      // priced in the territory responsible lending exists to prevent. A flip
      // mandate (refurbishment or development) carries the higher ceiling.
      throw new Error(
        `Required return must be no more than ${returnCapFor(flip) / 100}% a year`,
      );
    }

    const id = idFrom(formData.get("id"));
    const existing = id !== undefined ? await getFundingBox(id) : undefined;
    const owner = viewerAccount(viewer);

    if (existing === undefined && owner !== undefined) {
      const entitlements = await entitlementsForAccount(owner);
      const mine = (await listFundingBoxes()).filter((b) => b.ownerAccountId === owner.id);
      const decision = withinLimit(mine.length, entitlements.maxFundingBoxes, "Funding Boxes");
      if (!decision.allowed) {
        return { ok: false, message: decision.reason };
      }
    }

    // Decided by canManageMandate, not here: operator manages any, customer
    // manages only a mandate they own. The id arrives in the form.
    if (existing !== undefined && owner !== undefined) {
      const decision = canManageMandate(owner, existing.ownerAccountId);
      if (!decision.allowed) return { ok: false, message: decision.reason };
    }

    const box: FundingBox = {
      id: existing?.id ?? `fund-${newToken()}`,
      // From the session, never from the form.
      ...(existing?.ownerAccountId !== undefined
        ? { ownerAccountId: existing.ownerAccountId }
        : owner !== undefined
          ? { ownerAccountId: owner.id }
          : {}),
      funderName: requiredText(formData.get("funderName"), "Lender name"),
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
      acceptsRefurbishment: flip.acceptsRefurbishment,
      acceptsDevelopment: flip.acceptsDevelopment,
      requiresFirstCharge: checkbox(formData.get("requiresFirstCharge")),
      minBorrowerCompletedDeals: requiredInteger(
        formData.get("minBorrowerCompletedDeals"),
        "Minimum completed deals",
        { min: 0, max: 100 },
      ),
      requiredReturnBps,
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
  const viewer = await requireMandateManagement("/capital");
  const box = await getFundingBox(id);
  if (box === undefined) return;
  const owner = viewerAccount(viewer);
  if (owner !== undefined && !canManageMandate(owner, box.ownerAccountId).allowed) return;
  await saveFundingBox({ ...box, active });
  revalidatePath("/capital");
}

export async function removeFundingBox(id: string): Promise<void> {
  const viewer = await requireMandateManagement("/capital");
  const owner = viewerAccount(viewer);
  if (owner !== undefined) {
    const box = await getFundingBox(id);
    if (box === undefined || !canManageMandate(owner, box.ownerAccountId).allowed) return;
  }
  await deleteFundingBox(id);
  revalidatePath("/capital");
}

function idFrom(raw: FormDataEntryValue | null): string | undefined {
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

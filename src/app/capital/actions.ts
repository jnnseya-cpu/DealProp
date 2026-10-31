"use server";

import { revalidatePath } from "next/cache";
import { newToken } from "@backend/auth/tokens";
import type { BoxFormResult } from "@shared/formFields";
import type { FundingBox } from "@shared/domain/matching";
import { parseFundingBoxFields } from "./parse";
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
 * The criteria are parsed by `parseFundingBoxFields`, shared with the preview.
 */

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
      // The criteria, parsed by the same function the public preview uses.
      ...parseFundingBoxFields(formData),
      // A verification already recorded is kept — editing the criteria does not
      // un-verify the funder; re-verification is its own recorded step.
      ...(existing?.verification !== undefined ? { verification: existing.verification } : {}),
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

"use server";

import { revalidatePath } from "next/cache";
import { newToken } from "@backend/auth/tokens";
import type { BoxFormResult } from "@shared/formFields";
import type { BuyBox } from "@shared/domain/matching";
import { parseBuyBoxFields } from "./parse";
import { deleteBuyBox, getBuyBox, listBuyBoxes, saveBuyBox } from "@backend/store/repository";
import { requireMandateManagement, viewerAccount } from "@/app/operator/guard";
import { canManageMandate } from "@shared/domain/accounts";
import { entitlementsForAccount } from "@backend/billing/entitlement";
import { withinLimit } from "@shared/domain/entitlements";

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
 *
 * Every action here checks its own permission. A server action is a POST
 * endpoint of its own, reachable without ever rendering the page that owns it,
 * so the page's guard does not cover it and the middleware matcher is a single
 * layer — and this codebase does not rely on a single layer for anything that
 * writes. Both consequences of getting this wrong are real: a mandate is a
 * plan-limited entitlement somebody pays for, and it is also a statement of
 * buyer demand shown to sellers, which nobody unauthenticated may author.
 */

export async function saveBuyBoxAction(
  _previous: BoxFormResult | undefined,
  formData: FormData,
): Promise<BoxFormResult> {
  const viewer = await requireMandateManagement("/invest");

  try {
    const id = idFrom(formData.get("id"));
    const existing = id !== undefined ? await getBuyBox(id) : undefined;
    const owner = viewerAccount(viewer);

    // Editing an existing mandate is not creating one, so the limit applies to
    // new records only. Checking on every save would make a customer at their
    // limit unable to correct the mandates they already have.
    if (existing === undefined && owner !== undefined) {
      const entitlements = await entitlementsForAccount(owner);
      const mine = (await listBuyBoxes()).filter((b) => b.ownerAccountId === owner.id);
      const decision = withinLimit(mine.length, entitlements.maxBuyBoxes, "Buy Boxes");
      if (!decision.allowed) {
        return { ok: false, message: decision.reason };
      }
    }

    // Somebody else's mandate. The id arrives in the form, so without this a
    // customer could edit any mandate on the platform by guessing an id. The
    // decision is canManageMandate's, not this action's: an operator account
    // manages any, a customer only one they own.
    if (existing !== undefined && owner !== undefined) {
      const decision = canManageMandate(owner, existing.ownerAccountId);
      if (!decision.allowed) return { ok: false, message: decision.reason };
    }

    const box: BuyBox = {
      id: existing?.id ?? `buy-${newToken()}`,
      // Ownership is taken from the session, never from the form. A form field
      // naming the owner is a form field somebody can set to another account.
      ...(existing?.ownerAccountId !== undefined
        ? { ownerAccountId: existing.ownerAccountId }
        : owner !== undefined
          ? { ownerAccountId: owner.id }
          : {}),
      // The criteria themselves — parsed by the same function the public
      // preview uses, so a saved mandate and a previewed one mean the same thing.
      ...parseBuyBoxFields(formData),
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
  const viewer = await requireMandateManagement("/invest");
  const box = await getBuyBox(id);
  if (box === undefined) return;
  const owner = viewerAccount(viewer);
  if (owner !== undefined && !canManageMandate(owner, box.ownerAccountId).allowed) return;
  await saveBuyBox({ ...box, active });
  revalidatePath("/invest");
}

export async function removeBuyBox(id: string): Promise<void> {
  const viewer = await requireMandateManagement("/invest");
  const owner = viewerAccount(viewer);
  if (owner !== undefined) {
    const box = await getBuyBox(id);
    if (box === undefined || !canManageMandate(owner, box.ownerAccountId).allowed) return;
  }
  await deleteBuyBox(id);
  revalidatePath("/invest");
}

function idFrom(raw: FormDataEntryValue | null): string | undefined {
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

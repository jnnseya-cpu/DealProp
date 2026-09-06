"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { getDeal, saveDeal } from "@backend/store/repository";
import { audit } from "@backend/audit";
import { CATEGORIES, type ConfirmedBy, type InventoryCategory } from "@shared/domain/inventory";

/**
 * Recording that somebody said the property is for sale.
 *
 * This is the first question the platform asks about any opportunity and, until
 * now, the only one with nowhere to answer it. `quoteReveal()` refuses on
 * unconfirmed stock, `inventoryOf()` reads an absent category as AI-discovered,
 * and no screen wrote either — so every opportunity on the platform was
 * unsellable and would have stayed that way however many permissions were held.
 *
 * The category and the confirmation are recorded together on purpose. They are
 * separate fields because `categoryDefect()` has to be able to catch them
 * disagreeing, but a form that let somebody set one without the other would be
 * a form whose main use was creating that disagreement.
 */

export interface InventoryResult {
  readonly ok: boolean;
  readonly message: string;
}

function isCategory(value: string): value is InventoryCategory {
  return CATEGORIES.some((c) => c.category === value);
}

export async function recordConfirmationAction(
  _previous: InventoryResult | undefined,
  formData: FormData,
): Promise<InventoryResult> {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const evidence = String(formData.get("evidence") ?? "").trim();

  const viewer = await requirePermission("view-seller-data", `/deals/${dealId}/seller-checks`);
  const account = viewerAccount(viewer);
  if (account === undefined) {
    return {
      ok: false,
      message:
        "A confirmation is somebody stating that a person told them the property is for sale. The shared operator password is nobody in particular — sign in with your own account.",
    };
  }

  if (!isCategory(category)) return { ok: false, message: "No such category." };

  const record = await getDeal(dealId);
  if (record === undefined) return { ok: false, message: "No such deal." };

  const definition = CATEGORIES.find((c) => c.category === category);
  const by: ConfirmedBy | undefined = definition?.requiresConfirmationBy;

  // AI-discovered is the one category that takes no confirmation, and setting
  // it has to be able to clear one — a property wrongly marked owner-verified
  // must be demotable, or the mistake is permanent.
  if (by === undefined) {
    await saveDeal({ ...record, inventory: { category } });
    await audit("sale-confirmation-recorded", {
      account,
      subject: dealId,
      detail: `${category} — confirmation cleared`,
    });
    revalidatePath(`/deals/${dealId}/seller-checks`);
    revalidatePath(`/opportunities/${dealId}`);
    return {
      ok: true,
      message:
        "Recorded as AI-discovered. Nobody is recorded as having confirmed it, so it may be shown with that sentence but not sold.",
    };
  }

  if (evidence === "") {
    return {
      ok: false,
      message:
        "Say what they actually told you. A confirmation with no words behind it is a tick box, and the whole point of this record is that a buyer paid for what it says.",
    };
  }

  await saveDeal({
    ...record,
    inventory: {
      category,
      confirmation: {
        by,
        at: new Date().toISOString(),
        recordedBy: account.name,
        evidence,
      },
    },
  });

  await audit("sale-confirmation-recorded", {
    account,
    subject: dealId,
    detail: `${category} — confirmed by ${by}`,
  });

  revalidatePath(`/deals/${dealId}/seller-checks`);
  revalidatePath(`/opportunities/${dealId}`);
  return {
    ok: true,
    message: `Recorded against ${account.name}. The remaining checks decide whether it may be marketed.`,
  };
}

"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { claimRevealRefund, openOpportunity } from "@backend/billing/reveal";
import { REFUND_REASONS, type RefundTrigger } from "@shared/domain/reveal";

/**
 * Opening an opportunity, and claiming the fee back.
 *
 * Server actions are POST endpoints of their own, so each checks its own
 * permission. Neither takes an amount and neither takes a category: the price
 * comes from the catalogue and the category from the record, both on the
 * server. A form that could post either could buy a portfolio disposal at the
 * standard-residential price, and the failure would be silent.
 */

export interface OpenResult {
  readonly ok: boolean;
  readonly message: string;
}

function isTrigger(value: string): value is RefundTrigger {
  return REFUND_REASONS.some((r) => r.trigger === value);
}

export async function openOpportunityAction(
  _previous: OpenResult | undefined,
  formData: FormData,
): Promise<OpenResult> {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const viewer = await requirePermission("view-deal-material", `/opportunities/${dealId}`);
  const account = viewerAccount(viewer);
  if (account === undefined) {
    return {
      ok: false,
      message:
        "Opening an opportunity is a purchase by a named person, and the shared operator password is nobody in particular. Sign in with an account.",
    };
  }

  const result = await openOpportunity(
    dealId,
    account,
    String(formData.get("paymentReference") ?? ""),
  );
  if (result.ok) revalidatePath(`/opportunities/${dealId}`);
  return result;
}

export async function claimRefundAction(
  _previous: OpenResult | undefined,
  formData: FormData,
): Promise<OpenResult> {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const trigger = String(formData.get("trigger") ?? "").trim();
  if (!isTrigger(trigger)) return { ok: false, message: "No such reason." };

  const viewer = await requirePermission("view-deal-material", `/opportunities/${dealId}`);
  const account = viewerAccount(viewer);
  if (account === undefined) {
    return { ok: false, message: "A refund is paid to a named account. Sign in with one." };
  }

  const result = await claimRevealRefund(
    String(formData.get("revealId") ?? "").trim(),
    account.id,
    trigger,
  );
  if (result.ok) revalidatePath(`/opportunities/${dealId}`);
  return result;
}

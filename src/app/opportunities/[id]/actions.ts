"use server";

import { revalidatePath } from "next/cache";
import { currentViewer, requirePermission, viewerAccount } from "@/app/operator/guard";
import { claimRevealRefund, openOpportunity } from "@backend/billing/reveal";
import { REFUND_REASONS, type RefundTrigger } from "@shared/domain/reveal";
import { mayResell, type ResaleArrangement } from "@shared/domain/reseller";
import { optionalMoney } from "@shared/formFields";
import { ZERO } from "@shared/money";
import { getDeal, saveDeal } from "@backend/store/repository";
import { audit } from "@backend/audit";

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

/**
 * A reseller takes on a listing they may market.
 *
 * Gated by `mayResell`: the owner must have authorised reselling and the
 * reseller must hold their own verified AML + redress. Records the reseller's
 * agreed fee on the deal (Lode's cut is a share of it), seeing only the
 * closed-shape card — this action never reads seller data. It is its own POST
 * endpoint and decides for itself who is asking (`currentViewer`), so it does
 * not borrow the buyer's `view-deal-material` gate, which a reseller need not
 * hold.
 */
export async function takeOnListingAction(
  _previous: OpenResult | undefined,
  formData: FormData,
): Promise<OpenResult> {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const viewer = await currentViewer();
  const account = viewer !== undefined ? viewerAccount(viewer) : undefined;
  if (account === undefined) {
    return { ok: false, message: "Taking on a listing is done by a named account. Sign in with one." };
  }

  const record = await getDeal(dealId);
  if (record === undefined) return { ok: false, message: "No such opportunity." };

  const decision = mayResell({
    compliance: account.sourcerCompliance,
    resaleConsent: record.resaleConsent,
  });
  if (!decision.allowed) return { ok: false, message: decision.reason };

  const feeAgreed = optionalMoney(formData.get("feeAgreed"));
  if (feeAgreed === undefined || feeAgreed <= ZERO) {
    return { ok: false, message: "State the fee you will charge on the onward sale — Lode's cut is a share of it." };
  }

  const arrangement: ResaleArrangement = {
    resellerAccountId: account.id,
    resellerName: account.name,
    feeAgreed,
    engagedAt: new Date().toISOString(),
  };
  await saveDeal({ ...record, resale: arrangement });
  await audit("mandate-saved", {
    account,
    subject: dealId,
    detail: `${record.reference}: ${account.name} took on the listing to resell, fee agreed ${feeAgreed} pence.`,
  });
  revalidatePath(`/opportunities/${dealId}`);
  return { ok: true, message: "You have taken this on. Lode's cut is due on completion of the onward sale." };
}

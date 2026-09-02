"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { raiseFee, recordFeeDisclosure, voidFee } from "@backend/billing/fees";
import type { Actor } from "@shared/domain/agents";
import { FEE_DEFINITIONS, type FeeKey } from "@shared/domain/fees";

/**
 * Raising and disclosing fees.
 *
 * Server actions are POST endpoints of their own, so each checks its own
 * permission. None of them takes an amount: a request names the deal and the
 * fee, and the figure is computed on the server from the catalogue — a
 * validated amount is only ever as good as its validation, and the failure is
 * silent and total.
 */

export interface FeeResult {
  readonly ok: boolean;
  readonly message: string;
}

async function actorFor(dealId: string): Promise<Actor> {
  const viewer = await requirePermission("view-seller-data", `/deals/${dealId}/fees`);
  const account = viewerAccount(viewer);
  return account === undefined
    ? { kind: "shared-operator" }
    : { kind: "account", id: account.id, name: account.name, email: account.email };
}

function isFeeKey(value: string): value is FeeKey {
  return FEE_DEFINITIONS.some((f) => f.key === value);
}

export async function recordDisclosureAction(
  _previous: FeeResult | undefined,
  formData: FormData,
): Promise<FeeResult> {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const actor = await actorFor(dealId);
  const result = await recordFeeDisclosure(dealId, String(formData.get("wording") ?? ""), actor);
  if (result.ok) revalidatePath(`/deals/${dealId}/fees`);
  return result;
}

export async function raiseFeeAction(
  _previous: FeeResult | undefined,
  formData: FormData,
): Promise<FeeResult> {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const feeKey = String(formData.get("feeKey") ?? "").trim();
  if (!isFeeKey(feeKey)) return { ok: false, message: "No such fee." };

  const actor = await actorFor(dealId);
  const result = await raiseFee(dealId, feeKey, String(formData.get("note") ?? ""), actor);
  if (result.ok) revalidatePath(`/deals/${dealId}/fees`);
  return result;
}

export async function voidFeeAction(
  _previous: FeeResult | undefined,
  formData: FormData,
): Promise<FeeResult> {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const actor = await actorFor(dealId);
  const result = await voidFee(
    dealId,
    String(formData.get("feeId") ?? "").trim(),
    String(formData.get("reason") ?? ""),
    actor,
  );
  if (result.ok) revalidatePath(`/deals/${dealId}/fees`);
  return result;
}

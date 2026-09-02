"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import {
  raiseFee,
  recordExistingInstruction,
  recordFeeDisclosure,
  recordSellerAgreement,
  voidFee,
} from "@backend/billing/fees";
import type { Actor } from "@shared/domain/agents";
import { FEE_DEFINITIONS, type FeeKey, type InstructionKind } from "@shared/domain/fees";
import { SUCCESS_FEE_BANDS, type SellerService } from "@shared/domain/pricing";

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

function isSellerService(value: string): value is SellerService {
  return SUCCESS_FEE_BANDS.some((b) => b.service === value);
}

const INSTRUCTION_KINDS: readonly InstructionKind[] = [
  "none",
  "multi-agency",
  "sole-agency",
  "sole-selling-rights",
];

function isInstructionKind(value: string): value is InstructionKind {
  return INSTRUCTION_KINDS.includes(value as InstructionKind);
}

/**
 * Record the seller's signature.
 *
 * The service is named, never the price. The band behind it is read from the
 * catalogue on the server, so a form that could post an amount could not have
 * changed what is charged.
 */
export async function recordSellerAgreementAction(
  _previous: FeeResult | undefined,
  formData: FormData,
): Promise<FeeResult> {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const service = String(formData.get("service") ?? "").trim();
  if (!isSellerService(service)) return { ok: false, message: "No such service." };

  const actor = await actorFor(dealId);
  const result = await recordSellerAgreement(
    dealId,
    service,
    String(formData.get("signedBy") ?? ""),
    actor,
  );
  if (result.ok) revalidatePath(`/deals/${dealId}/fees`);
  return result;
}

export async function recordInstructionAction(
  _previous: FeeResult | undefined,
  formData: FormData,
): Promise<FeeResult> {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const kind = String(formData.get("kind") ?? "").trim();
  if (!isInstructionKind(kind)) return { ok: false, message: "No such instruction." };

  const actor = await actorFor(dealId);
  const result = await recordExistingInstruction(
    dealId,
    kind,
    String(formData.get("agent") ?? ""),
    formData.get("released") === "on",
    actor,
  );
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

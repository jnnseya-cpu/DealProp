"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOperator, viewerAccount } from "@/app/operator/guard";
import { deleteDeal, getDeal } from "@backend/store/repository";
import { transitionDeal } from "@backend/workflow";
import type { DealStatus } from "@shared/domain/types";
import { audit } from "@backend/audit";

const DEAL_STATUSES: readonly DealStatus[] = ["new", "qualified", "in-market", "funded", "completed", "withdrawn"];

/**
 * Advance a deal to a new status (spec §10). Its own POST endpoint, so it
 * checks its own permission (#29). A transition is a person stating that the
 * transaction has moved, so it needs a named operator account, not the shared
 * password — the audit author must be somebody (§32/§51). The evidence gate
 * lives in the backend `transitionDeal`; this validates the shape and carries
 * the result back.
 */
export async function transitionDealAction(
  _prev: { ok: boolean; message: string } | undefined,
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const id = String(formData.get("id") ?? "").trim();
  const target = String(formData.get("target") ?? "").trim();
  const completedAt = String(formData.get("completedAt") ?? "").trim();

  const viewer = await requireOperator(`/deals/${id}`);
  const author = viewerAccount(viewer);
  if (author === undefined) {
    return { ok: false, message: "Advancing a deal needs a named operator account, not the shared password." };
  }
  if (id === "") return { ok: false, message: "No deal identified." };
  if (!(DEAL_STATUSES as readonly string[]).includes(target)) {
    return { ok: false, message: "Unknown status." };
  }

  const result = await transitionDeal(
    id,
    target as DealStatus,
    { id: author.id, email: author.email, name: author.name },
    completedAt !== "" ? { completedAt } : {},
  );
  if (result.ok) revalidatePath(`/deals/${id}`);
  return { ok: result.ok, message: result.message };
}

/**
 * Delete a deal, permanently.
 *
 * A deletion is irreversible, so it is gated three ways: the operator guard
 * (this is a POST endpoint of its own, §29), the deal must exist, and the
 * operator must type the deal's reference back — a stray tap cannot remove a
 * deal. The removal is recorded in the append-only audit trail with who did it
 * and which deal, so a delete is itself an event, not a silent disappearance.
 */
export async function deleteDealAction(
  _prev: { ok: boolean; message: string } | undefined,
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const id = String(formData.get("id") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim();

  const viewer = await requireOperator(`/deals/${id}`);
  const author = viewerAccount(viewer);

  if (id === "") return { ok: false, message: "No deal identified." };
  const record = await getDeal(id);
  if (record === undefined) return { ok: false, message: "No such deal — it may already be gone." };

  if (confirm.toUpperCase() !== record.reference.toUpperCase()) {
    return { ok: false, message: `Type the reference ${record.reference} exactly to confirm.` };
  }

  const removed = await deleteDeal(id);
  if (!removed) return { ok: false, message: "Nothing was removed." };

  await audit("mandate-deleted", {
    ...(author !== undefined ? { account: author } : {}),
    subject: `deal:${id}`,
    detail: `Deal ${record.reference} deleted (${record.property.locality} ${record.property.postcodeArea}).`,
  });

  revalidatePath("/deals");
  redirect("/deals");
}

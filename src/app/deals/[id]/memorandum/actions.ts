"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { getDeal, saveDeal } from "@backend/store/repository";
import { recordPackHash } from "@backend/packApproval";
import { PACK_VERSION } from "@shared/domain/packApproval";
import type { DealRecord } from "@backend/store/schema";
import { audit } from "@backend/audit";

/**
 * Approve this pack for release, binding the approval to the pack's current
 * content hash (spec §8/§10).
 *
 * Its own permission check: the memorandum page admits a certified external
 * investor (they may read deal material), but approving a pack for release is
 * an operator judgement, so this requires `manage-mandates`, which only staff
 * hold (§29). And it requires a named account — the shared operator password
 * has nobody behind it, and an approval needs an author (§32/§51).
 */
export async function approvePack(formData: FormData): Promise<void> {
  const id = String(formData.get("dealId") ?? "");
  const viewer = await requirePermission("manage-mandates", `/deals/${id}/memorandum`);
  const account = viewerAccount(viewer);
  if (account === undefined) {
    throw new Error("Approving a pack needs a named operator account, not the shared password.");
  }

  const record = await getDeal(id);
  if (record === undefined) throw new Error("Deal not found.");

  const approved: DealRecord = {
    ...record,
    packApproval: {
      contentHash: recordPackHash(record),
      approvedBy: account.name,
      approvedAt: new Date().toISOString(),
      packVersion: PACK_VERSION,
    },
  };
  await saveDeal(approved);
  await audit("pack-approved", {
    account,
    subject: record.id,
    detail: `${record.reference} pack approved for release.`,
  });
  revalidatePath(`/deals/${id}/memorandum`);
}

"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { closeIntakeConversation, operatorReply } from "@backend/intake/service";

/**
 * Operator actions on an intake conversation (§12/§51).
 *
 * Each is its own POST endpoint and checks its own permission — the page guard
 * does not cover a server action (decision #29). Reading and acting on a
 * seller's words needs `view-seller-data`, and replying or closing is a
 * person stating a judgement, so it needs a named account: the shared operator
 * password has nobody behind it to be the author (§51/§32).
 */

const MAX_MESSAGE = 4_000;

export async function replyToSeller(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const text = String(formData.get("message") ?? "").trim().slice(0, MAX_MESSAGE);
  const viewer = await requirePermission("view-seller-data", `/operator/intake/${id}`);
  const account = viewerAccount(viewer);
  if (account === undefined) {
    throw new Error("Replying to a seller needs a named operator account, not the shared password.");
  }
  if (id === "" || text === "") return;
  await operatorReply(id, { id: account.id, email: account.email, name: account.name }, text);
  revalidatePath(`/operator/intake/${id}`);
  revalidatePath("/operator/intake");
}

export async function closeConversation(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const viewer = await requirePermission("view-seller-data", `/operator/intake/${id}`);
  const account = viewerAccount(viewer);
  if (account === undefined) {
    throw new Error("Closing a conversation needs a named operator account, not the shared password.");
  }
  if (id === "") return;
  await closeIntakeConversation(id, { id: account.id, email: account.email, name: account.name });
  revalidatePath(`/operator/intake/${id}`);
  revalidatePath("/operator/intake");
}

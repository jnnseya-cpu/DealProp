"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { resolveOperatorTask } from "@backend/tasks";

/**
 * Resolve an operator worklist task (§9/A03). Its own POST endpoint, checking
 * its own permission (#29); resolving is a person taking it off the queue, so
 * it needs a named account and a note, not the shared password (§32/§51).
 */
export async function resolveTaskAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 2_000);
  const viewer = await requirePermission("view-audit-log", "/operator/tasks");
  const account = viewerAccount(viewer);
  if (account === undefined) {
    throw new Error("Resolving a task needs a named operator account, not the shared password.");
  }
  if (id === "" || note === "") return;
  await resolveOperatorTask(id, note, { id: account.id, email: account.email, name: account.name });
  revalidatePath("/operator/tasks");
}

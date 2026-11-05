"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { acknowledgeAgentRun } from "@backend/agents/service";

/**
 * Operator actions on the agent-run Control Room (§20.12).
 *
 * Its own POST endpoint, checking its own permission — the page guard does not
 * cover a server action (decision #29). Acknowledging a waiting run is a person
 * saying they have taken it on, so it needs a named account and a reason, not
 * the shared operator password (§51/§32).
 */

const MAX_NOTE = 2_000;

export async function acknowledgeRunAction(formData: FormData): Promise<void> {
  const runId = String(formData.get("runId") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, MAX_NOTE);
  const viewer = await requirePermission("view-audit-log", "/operator/agents");
  const account = viewerAccount(viewer);
  if (account === undefined) {
    throw new Error("Acknowledging a run needs a named operator account, not the shared password.");
  }
  if (runId === "" || note === "") return;
  await acknowledgeAgentRun({
    runId,
    note,
    actor: { kind: "account", id: account.id, name: account.name, email: account.email },
  });
  revalidatePath("/operator/agents");
}

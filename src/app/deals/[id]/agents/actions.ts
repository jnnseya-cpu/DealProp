"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { decideProposal } from "@backend/agents/service";
import type { Actor } from "@shared/domain/agents";

/**
 * Deciding an agent proposal.
 *
 * A server action is a POST endpoint of its own, so it checks its own
 * permission — the page guard above it does not cover this call and the
 * middleware matcher is one layer, not three.
 *
 * The form sends a deal id, a proposal key, accept or dismiss, and a reason.
 * It does not send what accepting would do. The agents are re-run server-side
 * and the effect is read from the proposal found in that run, so a crafted
 * request cannot name its own effect.
 */

export interface DecisionResult {
  readonly ok: boolean;
  readonly message: string;
}

export async function decideProposalAction(
  _previous: DecisionResult | undefined,
  formData: FormData,
): Promise<DecisionResult> {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const viewer = await requirePermission("view-seller-data", `/deals/${dealId}/agents`);
  const account = viewerAccount(viewer);

  const actor: Actor =
    account === undefined
      ? { kind: "shared-operator" }
      : { kind: "account", id: account.id, name: account.name, email: account.email };

  const raw = String(formData.get("decision") ?? "");
  if (raw !== "accepted" && raw !== "dismissed") {
    return { ok: false, message: "Accept it or dismiss it." };
  }

  const outcome = await decideProposal({
    dealId,
    proposalKey: String(formData.get("proposalKey") ?? "").trim(),
    decision: raw,
    note: String(formData.get("note") ?? ""),
    actor,
  });

  if (outcome.ok) revalidatePath(`/deals/${dealId}/agents`);
  return outcome;
}

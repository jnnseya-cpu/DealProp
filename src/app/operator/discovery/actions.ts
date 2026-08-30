"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { listDiscoveryCandidates, saveDiscoveryCandidate } from "@backend/store/repository";
import { audit } from "@backend/audit";

/**
 * Approving a discovered funder, or suppressing one.
 *
 * A candidate arrives quarantined and stays that way until a person looks at it.
 * That person is named, because approving a recipient is deciding that it is
 * lawful and appropriate to write to them about somebody's property
 * transaction, and a decision like that needs somebody behind it rather than a
 * confidence score.
 */

export interface CandidateResult {
  readonly ok: boolean;
  readonly message: string;
}

export async function approveCandidateAction(
  _previous: CandidateResult | undefined,
  formData: FormData,
): Promise<CandidateResult> {
  const viewer = await requirePermission("manage-mandates", "/operator/discovery");
  const author = viewerAccount(viewer);
  if (author === undefined) {
    return {
      ok: false,
      message:
        "Approving a recipient needs a named person. Sign in with your own account rather than the shared password.",
    };
  }

  const id = String(formData.get("candidateId") ?? "").trim();
  const entry = (await listDiscoveryCandidates()).find((c) => c.candidate.id === id);
  if (entry === undefined) return { ok: false, message: "No such candidate." };

  if (entry.candidate.doNotContact || entry.candidate.optedOut) {
    return {
      ok: false,
      message: "This candidate is suppressed. Suppression is not something an approval overrides.",
    };
  }
  if (entry.candidate.status !== "VERIFIED") {
    return {
      ok: false,
      message: `Status is ${entry.candidate.status}. Only a fully verified candidate may be approved — resolve what is missing first.`,
    };
  }

  const at = new Date().toISOString();
  await saveDiscoveryCandidate({ ...entry, approvedAt: at, approvedBy: author.email });
  await audit("mandate-saved", {
    account: author,
    subject: entry.candidate.id,
    detail: `Approved ${entry.candidate.organisationName} for outreach.`,
  });

  revalidatePath("/operator/discovery");
  return { ok: true, message: `${entry.candidate.organisationName} approved, recorded against your name.` };
}

export async function suppressCandidateAction(
  _previous: CandidateResult | undefined,
  formData: FormData,
): Promise<CandidateResult> {
  const viewer = await requirePermission("manage-mandates", "/operator/discovery");
  const author = viewerAccount(viewer);

  const id = String(formData.get("candidateId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const entry = (await listDiscoveryCandidates()).find((c) => c.candidate.id === id);
  if (entry === undefined) return { ok: false, message: "No such candidate." };

  await saveDiscoveryCandidate({
    ...entry,
    candidate: { ...entry.candidate, doNotContact: true },
    notes: [...entry.notes, `Suppressed: ${reason === "" ? "no reason given" : reason}`],
  });
  await audit("mandate-deleted", {
    ...(author !== undefined ? { account: author } : {}),
    subject: entry.candidate.id,
    detail: `Suppressed ${entry.candidate.organisationName}. ${reason}`,
  });

  revalidatePath("/operator/discovery");
  return { ok: true, message: `${entry.candidate.organisationName} will not be contacted.` };
}

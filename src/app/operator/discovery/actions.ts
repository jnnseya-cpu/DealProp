"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { listDiscoveryCandidates, saveDiscoveryCandidate } from "@backend/store/repository";
import { runDiscovery } from "@backend/discovery/run";
import type { VerificationInput } from "@backend/discovery/connectors";
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

/**
 * Run discovery against organisations an operator has named.
 *
 * One per line: `Name, domain, company number, FRN` — the last two optional.
 * A list rather than a search query, because no source is licensed for
 * harvesting the web for firms, and a crawler that wanders from link to link
 * collecting organisations would be reading things nobody offered.
 */
export async function runDiscoveryAction(
  _previous: CandidateResult | undefined,
  formData: FormData,
): Promise<CandidateResult> {
  const viewer = await requirePermission("manage-mandates", "/operator/discovery");
  const author = viewerAccount(viewer);

  const raw = String(formData.get("targets") ?? "").trim();
  if (raw === "") {
    return { ok: false, message: "Name at least one organisation, one per line." };
  }

  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 25) {
    // A run is bounded so a paste of a thousand rows cannot become a crawl.
    return { ok: false, message: "At most 25 organisations per run." };
  }

  const targets: VerificationInput[] = [];
  const rejected: string[] = [];

  for (const line of lines) {
    const [name, domain, companyNumber, firmReference] = line.split(",").map((p) => p.trim());
    if (name === undefined || name === "" || domain === undefined || domain === "") {
      rejected.push(`${line} — needs at least a name and a domain.`);
      continue;
    }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      rejected.push(`${domain} is not a domain.`);
      continue;
    }
    targets.push({
      organisationName: name,
      domain: domain.toLowerCase().replace(/^www\./, ""),
      ...(companyNumber !== undefined && companyNumber !== "" ? { companyNumber } : {}),
      ...(firmReference !== undefined && firmReference !== "" ? { firmReference } : {}),
    });
  }

  if (targets.length === 0) {
    return { ok: false, message: `Nothing usable. ${rejected.join(" ")}` };
  }

  const result = await runDiscovery(targets);

  await audit("mandate-saved", {
    ...(author !== undefined ? { account: author } : {}),
    subject: "discovery-run",
    detail: `Examined ${result.examined} organisation(s) in ${result.requestsMade} request(s): ${result.verified} verified, ${result.quarantined} quarantined, ${result.refused} refused.`,
  });

  revalidatePath("/operator/discovery");
  return {
    ok: true,
    message: `${result.examined} examined in ${result.requestsMade} request(s): ${result.verified} verified, ${result.quarantined} need more evidence, ${result.refused} refused.${rejected.length > 0 ? ` Skipped: ${rejected.join(" ")}` : ""}`,
  };
}

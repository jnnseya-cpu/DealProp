import { Fetcher } from "@backend/discovery/fetcher";
import { buildCandidate, type VerificationInput } from "@backend/discovery/connectors";
import { listDiscoveryCandidates, saveDiscoveryCandidate } from "@backend/store/repository";
import { reconcile } from "@shared/domain/outreach";
import type { StoredCandidate } from "@backend/store/schema";

/**
 * One discovery run.
 *
 * Takes organisations an operator has named — from a trade directory, a
 * conference list, a referral, an imported spreadsheet — and does the part that
 * has to be done consistently: confirm the company exists and is trading,
 * confirm any regulatory claim against the register, read the mandate the
 * organisation itself published, and take a contact address only where one is
 * published for the purpose.
 *
 * It does not go looking on its own. There is no crawler here that wanders from
 * link to link collecting firms, because there is no source licensed for that:
 * the registry permits reading a *named* organisation's own site, not
 * harvesting the web for organisations. That distinction is the difference
 * between a permitted read and an unwelcome one, and it is why the input to
 * this function is a list rather than a search query.
 *
 * Everything it produces is quarantined. A candidate exists, is reviewable, and
 * cannot be written to until a person has approved it.
 */

export interface DiscoveryRunResult {
  readonly examined: number;
  readonly verified: number;
  readonly quarantined: number;
  readonly refused: number;
  readonly requestsMade: number;
  readonly notes: readonly string[];
}

export async function runDiscovery(
  targets: readonly VerificationInput[],
  options: { readonly fetcher?: Fetcher } = {},
): Promise<DiscoveryRunResult> {
  const fetcher = options.fetcher ?? new Fetcher();
  const existing = await listDiscoveryCandidates();
  const notes: string[] = [];
  let verified = 0;
  let quarantined = 0;
  let refused = 0;

  for (const target of targets) {
    const { candidate, notes: candidateNotes } = await buildCandidate(fetcher, target);

    // The same organisation found twice resolves to one record, keeping every
    // source's provenance rather than the newest overwriting the rest.
    const previous = existing.find(
      (entry) =>
        entry.candidate.domain?.value.toLowerCase() === candidate.domain?.value.toLowerCase(),
    );

    const merged: StoredCandidate = {
      candidate: previous === undefined ? candidate : reconcile(previous.candidate, candidate),
      notes: [...(previous?.notes ?? []), ...candidateNotes],
      discoveredAt: previous?.discoveredAt ?? new Date().toISOString(),
      ...(previous?.approvedAt !== undefined
        ? { approvedAt: previous.approvedAt, approvedBy: previous.approvedBy }
        : {}),
    };

    await saveDiscoveryCandidate(merged);
    notes.push(`${merged.candidate.organisationName}: ${merged.candidate.status}`);

    if (merged.candidate.status === "VERIFIED") verified += 1;
    else if (merged.candidate.status === "REJECTED" || merged.candidate.status === "CONFLICTING") refused += 1;
    else quarantined += 1;
  }

  return {
    examined: targets.length,
    verified,
    quarantined,
    refused,
    requestsMade: fetcher.requestsMade,
    notes,
  };
}

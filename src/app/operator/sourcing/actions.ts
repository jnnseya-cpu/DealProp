"use server";

import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { audit } from "@backend/audit";
import { runFromDatasets, runRegisters } from "@backend/discovery/sourcingRun";
import type { FlipEvidence, SourcedLead } from "@shared/domain/sourcedLead";

/**
 * Running the register adapters from the operator surface.
 *
 * Two lawful paths and no third. A dataset the operator already holds (the
 * licensed open bulk files), joined offline; or the Gazette's public notices,
 * fetched through the Fetcher under its licence. Neither contacts anyone: a run
 * produces leads for a named person to work, and the lawful next step travels
 * with each one. There is deliberately no "approach" action here.
 */

export interface SourcingResult {
  readonly ok: boolean;
  readonly message: string;
  readonly leads: readonly SourcedLead[];
  readonly flips: readonly FlipEvidence[];
  readonly notes: readonly string[];
}

/** A paste of a licensed dataset cannot be unbounded; a CSV this big is a file. */
const MAX_CSV_CHARS = 2_000_000;

export async function runDatasetAction(
  _previous: SourcingResult | undefined,
  formData: FormData,
): Promise<SourcingResult> {
  const viewer = await requirePermission("manage-mandates", "/operator/sourcing");
  const author = viewerAccount(viewer);

  const ppd = String(formData.get("ppd") ?? "");
  const epc = String(formData.get("epc") ?? "");
  if (ppd.trim() === "" || epc.trim() === "") {
    return { ok: false, message: "Provide both the Price Paid and the EPC data to join them.", leads: [], flips: [], notes: [] };
  }
  if (ppd.length > MAX_CSV_CHARS || epc.length > MAX_CSV_CHARS) {
    return {
      ok: false,
      message: "That is larger than a paste should be — load the bulk file through an ingestion job rather than the browser.",
      leads: [],
      flips: [],
      notes: [],
    };
  }

  let result;
  try {
    result = runFromDatasets(ppd, epc);
  } catch (error) {
    // A licence throw or a malformed file: report it rather than a blank page.
    return { ok: false, message: error instanceof Error ? error.message : "The data could not be read.", leads: [], flips: [], notes: [] };
  }

  await audit("mandate-saved", {
    ...(author !== undefined ? { account: author } : {}),
    subject: "sourcing-run-dataset",
    detail: `Dataset run: ${result.salesConsidered} sales, ${result.epcConsidered} certificates, ${result.leads.length} lead(s).`,
  });

  return { ok: true, message: result.note, leads: result.leads, flips: result.flips, notes: [] };
}

export async function runRegistersAction(
  _previous: SourcingResult | undefined,
  _formData: FormData,
): Promise<SourcingResult> {
  const viewer = await requirePermission("manage-mandates", "/operator/sourcing");
  const author = viewerAccount(viewer);

  const result = await runRegisters({
    ...(process.env.GAZETTE_DECEASED_CODE !== undefined ? { deceasedCode: process.env.GAZETTE_DECEASED_CODE } : {}),
    ...(process.env.GAZETTE_INSOLVENCY_CODE !== undefined ? { insolvencyCode: process.env.GAZETTE_INSOLVENCY_CODE } : {}),
  });

  await audit("mandate-saved", {
    ...(author !== undefined ? { account: author } : {}),
    subject: "sourcing-run-registers",
    detail: `Register run: ${result.requestsMade} request(s), ${result.leads.length} lead(s). ${result.notes.join(" ")}`,
  });

  return {
    ok: result.leads.length > 0,
    message:
      result.leads.length > 0
        ? `${result.leads.length} lead(s) from the public registers in ${result.requestsMade} request(s).`
        : "No leads. The registers were not reachable from here, or no notice code is configured — see the notes.",
    leads: result.leads,
    flips: [],
    notes: result.notes,
  };
}

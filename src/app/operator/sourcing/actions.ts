"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { audit } from "@backend/audit";
import { revalidatePath } from "next/cache";
import { runFromDatasets, runRegisters } from "@backend/discovery/sourcingRun";
import { listSourcedProperties, saveDeal, saveSourcedProperty } from "@backend/store/repository";
import { buildIntake, type IntakeAnswers } from "@shared/domain/intake";
import { bps, fromMajor, ZERO } from "@shared/money";
import { newToken } from "@backend/auth/tokens";
import type { FlipEvidence, SourcedLead } from "@shared/domain/sourcedLead";
import type { JurisdictionCode, PropertyType } from "@shared/domain/types";

const PROPERTY_TYPES = new Set<PropertyType>([
  "house", "flat", "bungalow", "hmo", "commercial", "mixed-use", "land",
]);
const JURISDICTIONS = new Set<JurisdictionCode>(["GB-ENG", "GB-SCT", "GB-WLS", "GB-NIR"]);

/** The human reference, random so it reveals no running count. */
function dealReference(): string {
  const alphabet = "ACDEFGHJKLMNPQRTUVWXY3479";
  return Array.from(randomBytes(6))
    .map((b) => alphabet[b % alphabet.length] ?? "")
    .join("");
}

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

  // Persist the worklist — but ONLY the property-fact leads. The distress leads
  // (probate, insolvency, negative equity) are shown live and never warehoused:
  // a list of the recently bereaved or the insolvent is exactly what data
  // minimisation exists to prevent, so the store will not hold one.
  const now = new Date().toISOString();
  let saved = 0;
  for (const lead of result.leads) {
    if (lead.signalKey !== "prepared-but-unsold" || lead.addressKey === undefined) continue;
    await saveSourcedProperty({ id: lead.addressKey, lead, firstSeenAt: now, lastSeenAt: now });
    saved += 1;
  }

  await audit("mandate-saved", {
    ...(author !== undefined ? { account: author } : {}),
    subject: "sourcing-run-dataset",
    detail: `Dataset run: ${result.salesConsidered} sales, ${result.epcConsidered} certificates, ${result.leads.length} lead(s), ${saved} saved to the worklist.`,
  });

  if (saved > 0) revalidatePath("/operator/sourcing");
  return { ok: true, message: result.note, leads: result.leads, flips: result.flips, notes: [] };
}

/**
 * Set a worklist property aside, with a reason.
 *
 * Low-stakes next to an approval or a money movement — it hides a lead nobody
 * is going to pursue — so the shared operator may do it. It survives a rerun:
 * a fresh dataset does not get to re-surface something a person dismissed.
 */
export async function dismissSourcedPropertyAction(
  _previous: { ok: boolean; message: string } | undefined,
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const viewer = await requirePermission("manage-mandates", "/operator/sourcing");
  const author = viewerAccount(viewer);

  const id = String(formData.get("id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (id === "") return { ok: false, message: "No property identified." };

  const entry = (await listSourcedProperties()).find((p) => p.id === id);
  if (entry === undefined) return { ok: false, message: "No such property on the worklist." };

  await saveSourcedProperty({
    ...entry,
    dismissed: {
      at: new Date().toISOString(),
      by: author?.email ?? "operator",
      reason: reason === "" ? "no reason given" : reason,
    },
  });
  await audit("mandate-deleted", {
    ...(author !== undefined ? { account: author } : {}),
    subject: `sourced-property:${id}`,
    detail: `Set aside. ${reason}`,
  });

  revalidatePath("/operator/sourcing");
  return { ok: true, message: "Set aside." };
}

/**
 * Turn a probate lead into a deal in the pipeline.
 *
 * The bridge from lead to deal, so the operator does not re-key an address the
 * platform already holds. It creates a real deal at status "new" and lands on
 * the seller-checks step — because the next thing that must happen on a probate
 * deal is proving the authority to sell (the grant of probate), which is where
 * these deals succeed or fail.
 *
 * The one figure that cannot be defaulted is the value, so the operator gives
 * it — nothing is fabricated. Inventory is deliberately left unconfirmed: an
 * executor expressing interest is not yet the verified authority to sell, and
 * that verification is exactly the step this lands on. A server action is its
 * own POST endpoint, so it checks its own permission (§29).
 */
export async function startDealFromLead(
  _prev: { ok: boolean; message: string } | undefined,
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const viewer = await requirePermission("manage-mandates", "/operator/sourcing");
  const author = viewerAccount(viewer);

  const postcode = String(formData.get("postcode") ?? "").toUpperCase().trim();
  const address = String(formData.get("address") ?? "").trim();
  const subjectName = String(formData.get("subjectName") ?? "").trim();
  const contact = String(formData.get("contactForService") ?? "").trim();
  const pounds = Number(formData.get("estimatedValue"));
  const propertyTypeRaw = String(formData.get("propertyType") ?? "");
  const jurisdictionRaw = String(formData.get("jurisdiction") ?? "GB-ENG");

  if (postcode === "") return { ok: false, message: "This lead has no postcode to start a deal from." };
  if (!Number.isFinite(pounds) || pounds <= 0) {
    return { ok: false, message: "Enter an estimated value — it is the one figure that cannot be guessed." };
  }
  if (!PROPERTY_TYPES.has(propertyTypeRaw as PropertyType)) {
    return { ok: false, message: "Choose a property type." };
  }
  const propertyType = propertyTypeRaw as PropertyType;
  const jurisdiction = JURISDICTIONS.has(jurisdictionRaw as JurisdictionCode)
    ? (jurisdictionRaw as JurisdictionCode)
    : "GB-ENG";

  // Locality: the town, taken as the last address segment that is not the
  // postcode. Best-effort; the operator can refine it on the deal.
  const outward = postcode.split(" ")[0] ?? postcode;
  const segments = address
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "" && !s.toUpperCase().startsWith(outward));
  const locality = (segments[segments.length - 1] ?? "").slice(0, 80);

  const answers: IntakeAnswers = {
    situation: "probate",
    priorities: ["certainty"],
    narrative: `Started from a Gazette probate notice.${subjectName !== "" ? ` Estate of ${subjectName}.` : ""}${address !== "" ? ` Property: ${address}.` : ""}${contact !== "" ? ` Contact for service: ${contact}.` : ""}`,
    postcodeArea: postcode.slice(0, 8),
    locality,
    jurisdiction,
    propertyType,
    tenure: "freehold",
    bedrooms: 3,
    occupancy: "unknown",
    knownIssues: [],
    sellerValuation: fromMajor(Math.round(pounds)),
    condition: "needs-modernising",
    screening: {
      hasIndependentLegalAdvice: undefined,
      hasReceivedIndependentValuation: undefined,
      isSoleDecisionMaker: undefined,
      reportsFinancialDistress: undefined,
      reportsHealthOrCapacityConcern: undefined,
      isUnderTimePressureFromThirdParty: undefined,
      ageBand: "undisclosed",
    },
  };

  const intake = buildIntake(answers);
  const id = `deal-${newToken()}`;
  await saveDeal({
    id,
    reference: `LODE-${dealReference()}`,
    createdAt: new Date().toISOString(),
    property: intake.property,
    seller: intake.seller,
    inputs: {
      property: intake.property,
      seller: intake.seller,
      purchasePrice: intake.property.openMarketValue,
      buyerOwnsOtherProperty: true,
      buyerIsCompany: true,
      buyerIsNonResident: false,
      holdMonths: 9,
      structure: "cash-purchase",
      finance: {
        ltvBps: bps(0),
        refurbAdvanceBps: bps(0),
        annualRateBps: bps(0),
        arrangementFeeBps: bps(0),
        exitFeeBps: bps(0),
        interestRolledUp: false,
        lenderCosts: ZERO,
      },
      exit: "sell",
    },
    borrowerCompletedDeals: 0,
    status: "new",
  });

  await audit("mandate-saved", {
    ...(author !== undefined ? { account: author } : {}),
    subject: `deal:${id}`,
    detail: `Started from a probate lead${subjectName !== "" ? ` (estate of ${subjectName})` : ""} at ${postcode}.`,
  });

  redirect(`/deals/${id}/seller-checks`);
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

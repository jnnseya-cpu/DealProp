"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { audit } from "@backend/audit";
import { revalidatePath } from "next/cache";
import { runFromArea, runFromCouncil, runRegisters } from "@backend/discovery/sourcingRun";
import {
  clearContactedLead,
  listContactedLeads,
  listSourcedProperties,
  markContactedLead,
  saveDeal,
  saveSourcedProperty,
} from "@backend/store/repository";
import { buildIntake, type IntakeAnswers } from "@shared/domain/intake";
import { bps, fromMajor, ZERO } from "@shared/money";
import { newToken } from "@backend/auth/tokens";
import { fetchNoticeDetail } from "@backend/discovery/gazette";
import { Fetcher } from "@backend/discovery/fetcher";
import { companyIdentity } from "@shared/domain/identity";
import { draftProbateLetter } from "@shared/domain/probateLetter";
import { draftInsolvencyLetter } from "@shared/domain/insolvencyLetter";
import { enrichAddress } from "@backend/discovery/enrich";
import { leadContactKey } from "@shared/domain/sourcedLead";
import { runCounterpartyVerification } from "@backend/verification";
import type { SellerDueDiligence } from "@shared/domain/sellerDueDiligence";
import type { FlipEvidence, LeadSignal, SourcedLead } from "@shared/domain/sourcedLead";
import type { JurisdictionCode, PropertyType, SellerSituation, Tenure } from "@shared/domain/types";

const TENURES = new Set<Tenure>(["freehold", "leasehold", "share-of-freehold", "unknown"]);

const PROPERTY_TYPES = new Set<PropertyType>([
  "house", "flat", "bungalow", "hmo", "commercial", "mixed-use", "land",
]);
const JURISDICTIONS = new Set<JurisdictionCode>(["GB-ENG", "GB-SCT", "GB-WLS", "GB-NIR"]);
const LEAD_SIGNALS = new Set<LeadSignal>([
  "prepared-but-unsold", "probate-notice", "owner-insolvent", "negative-equity",
]);

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
 * Two lawful paths and no third. An area search — the EPC register and Land
 * Registry Price Paid queried for one postcode and joined on the address; or the
 * Gazette's public notices, fetched through the Fetcher under its licence.
 * Neither contacts anyone: a run produces leads for a named person to work, and
 * the lawful next step travels with each one. There is deliberately no
 * "approach" action here.
 */

export interface SourcingResult {
  readonly ok: boolean;
  readonly message: string;
  readonly leads: readonly SourcedLead[];
  readonly flips: readonly FlipEvidence[];
  readonly notes: readonly string[];
}

/** Only a well-formed UK postcode is sent to the two open APIs. */
const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

/**
 * Find prepared-but-unsold candidates for a postcode or a whole council / city.
 *
 * This replaced the dataset paste box, which never worked: the Price Paid bulk
 * file is gigabytes and cannot be pasted into a browser, so the join it promised
 * was unreachable. Here the operator types either a postcode — exact, fast — or
 * a council name, and the server runs the same EPC-to-Price-Paid join at that
 * scale. A full UK postcode routes to the single-postcode path; anything else is
 * treated as a council and swept (bounded and throttled). A server action is its
 * own POST endpoint, so it checks its own permission (§29).
 */
export async function runAreaAction(
  _previous: SourcingResult | undefined,
  formData: FormData,
): Promise<SourcingResult> {
  const viewer = await requirePermission("manage-mandates", "/operator/sourcing");
  const author = viewerAccount(viewer);

  const raw = String(formData.get("postcode") ?? "").trim();
  if (raw === "") {
    return { ok: false, message: "Enter a postcode or a council name to search.", leads: [], flips: [], notes: [] };
  }

  const isPostcode = UK_POSTCODE.test(raw);
  const result = isPostcode ? await runFromArea(raw.toUpperCase()) : await runFromCouncil(raw);

  // Drop anything already written to, so a run never re-surfaces a property a
  // letter has already gone to. Suppression is keyed by the lead's stable id.
  const contacted = new Set((await listContactedLeads()).map((c) => c.key));
  const leads = result.leads.filter((lead) => {
    const key = leadContactKey(lead);
    return key === undefined || !contacted.has(key);
  });

  // Persist the worklist — but ONLY the property-fact leads. The distress leads
  // (negative equity here) are shown live and never warehoused: a list of the
  // possibly-underwater is exactly what data minimisation exists to prevent, so
  // the store will not hold one.
  const now = new Date().toISOString();
  let saved = 0;
  for (const lead of leads) {
    if (lead.signalKey !== "prepared-but-unsold" || lead.addressKey === undefined) continue;
    await saveSourcedProperty({ id: lead.addressKey, lead, firstSeenAt: now, lastSeenAt: now });
    saved += 1;
  }

  await audit("mandate-saved", {
    ...(author !== undefined ? { account: author } : {}),
    subject: isPostcode ? "sourcing-run-area" : "sourcing-run-council",
    detail: `${isPostcode ? "Postcode" : "Council"} run for ${raw}: ${result.certificates} certificate(s), ${result.sales} sale(s), ${leads.length} lead(s), ${saved} saved to the worklist.`,
  });

  if (saved > 0) revalidatePath("/operator/sourcing");
  return {
    ok: leads.length > 0,
    message: result.note,
    leads,
    flips: result.flips,
    notes: result.notes,
  };
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
 * Mark a lead as written to, so it never surfaces on a future run.
 *
 * Called when the operator prints a letter — the one moment we know a property
 * or estate has actually been approached, so a second letter would be a repeat.
 * Beyond the stable key, it keeps three facts and no more — postcode, address,
 * the subject's name — so "Start a deal" still works from the Contacted list
 * once the live notice has rotated out of the feed. Lawful because the operator
 * has chosen to act on this lead, and reversible: Restore deletes it. Idempotent,
 * and a POST endpoint of its own, so it checks its own permission (§29). Returns
 * ok even when the key was already marked — printing a letter twice is not an
 * error here.
 */
export async function markLeadContacted(input: {
  readonly key: string;
  readonly signalKey: LeadSignal;
  readonly postcode?: string;
  readonly address?: string;
  readonly subjectName?: string;
}): Promise<{ ok: boolean }> {
  const viewer = await requirePermission("manage-mandates", "/operator/sourcing");
  const author = viewerAccount(viewer);

  const key = input.key.trim();
  if (key === "" || !LEAD_SIGNALS.has(input.signalKey)) return { ok: false };

  // Exactly three fields, each only when present.
  const startFacts = {
    ...(input.postcode !== undefined && input.postcode !== "" ? { postcode: input.postcode } : {}),
    ...(input.address !== undefined && input.address !== "" ? { address: input.address } : {}),
    ...(input.subjectName !== undefined && input.subjectName !== "" ? { subjectName: input.subjectName } : {}),
  };

  const marked = await markContactedLead({
    key,
    signalKey: input.signalKey,
    contactedAt: new Date().toISOString(),
    by: author?.email ?? "operator",
    ...(Object.keys(startFacts).length > 0 ? { startFacts } : {}),
  });
  if (marked) {
    await audit("mandate-saved", {
      ...(author !== undefined ? { account: author } : {}),
      subject: `sourced-lead-contacted:${input.signalKey}`,
      detail: `Letter printed; lead suppressed from future runs. key=${key}`,
    });
    revalidatePath("/operator/sourcing");
  }
  return { ok: true };
}

/**
 * Restore a contacted lead so it can surface again — the undo for a suppression.
 *
 * Reversibility matters: a print opened to review, then not posted, must not
 * hide a property for good. Clearing the mark lets the lead reappear on the next
 * run. Low-stakes and operator-only, so the shared operator may do it; it checks
 * its own permission (§29) all the same.
 */
export async function restoreContactedLeadAction(
  _previous: { ok: boolean; message: string } | undefined,
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const viewer = await requirePermission("manage-mandates", "/operator/sourcing");
  const author = viewerAccount(viewer);

  const key = String(formData.get("key") ?? "").trim();
  if (key === "") return { ok: false, message: "No lead identified." };

  const removed = await clearContactedLead(key);
  if (removed) {
    await audit("mandate-deleted", {
      ...(author !== undefined ? { account: author } : {}),
      subject: "sourced-lead-contacted",
      detail: `Suppression cleared; lead may surface again. key=${key}`,
    });
    revalidatePath("/operator/sourcing");
  }
  return { ok: true, message: removed ? "Restored." : "Nothing to restore." };
}

/**
 * Restore every contacted lead at once — the clean-slate reset.
 *
 * Clears all suppression so nothing a test (or an earlier run) marked contacted
 * stays hidden from the next search. It un-hides; it never deletes a lead. From
 * then on, printing a letter suppresses that lead again as normal. Operator-only
 * and audited, like the single restore (§29).
 */
export async function restoreAllContactedAction(
  _previous: { ok: boolean; message: string } | undefined,
  _formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const viewer = await requirePermission("manage-mandates", "/operator/sourcing");
  const author = viewerAccount(viewer);

  const all = await listContactedLeads();
  let cleared = 0;
  for (const c of all) {
    if (await clearContactedLead(c.key)) cleared += 1;
  }
  if (cleared > 0) {
    await audit("mandate-deleted", {
      ...(author !== undefined ? { account: author } : {}),
      subject: "sourced-lead-contacted",
      detail: `Reset: ${cleared} contacted lead(s) restored to search.`,
    });
    revalidatePath("/operator/sourcing");
  }
  return {
    ok: true,
    message:
      cleared > 0
        ? `Restored ${cleared}. Everything surfaces again until it is printed.`
        : "Nothing was suppressed — the list is already clear.",
  };
}

export interface ResolvedLetter {
  readonly ok: boolean;
  /**
   * The office-holder read from the notice, where it named one — the executor
   * (probate) or the trustee / Official Receiver (bankruptcy). This is who the
   * letter is posted to, never the bereaved or the bankrupt.
   */
  readonly contactForService?: string;
  /** The letter redrawn with whatever contact and deadline the notice gave. */
  readonly letter: string;
  readonly message?: string;
}

/**
 * Resolve a lead's office-holder on demand, and redraw its letter.
 *
 * Called when the operator opens a lead's letter, so every lead can have the
 * recipient filled in — not just a capped first slice — without the run fetching
 * every notice up front. One notice fetch, gated by the Fetcher like every
 * Gazette read. Kind-aware: a probate notice yields the executor and a probate
 * letter; a bankruptcy notice yields the trustee / Official Receiver and the
 * insolvency letter — never a letter to the debtor. A named person is on the
 * surface that triggers it, and the action checks its own permission (§29).
 */
export async function resolveLetter(input: {
  readonly kind: LeadSignal;
  readonly noticeUrl: string;
  readonly subjectName: string;
  readonly propertyAddress: string;
  /**
   * The office-holder's name and address, typed by the operator (read from the
   * notice, which anyone may open). When present it is used verbatim and NO fetch
   * is made — so a letter is always completable even where the Gazette forbids
   * reading its notice data automatically.
   */
  readonly contactOverride?: string;
  /**
   * The court the insolvency notice named, carried from the lead so the redraw
   * keeps the court hint where no office-holder resolves. Never fetched or
   * guessed here — it is only what the notice already stated.
   */
  readonly court?: string;
}): Promise<ResolvedLetter> {
  await requirePermission("manage-mandates", "/operator/sourcing");

  const sender = companyIdentity(process.env);
  const today = new Date().toISOString().slice(0, 10);

  let contactForService: string | undefined;
  let claimDeadline: string | undefined;
  let note: string | undefined;

  const override = input.contactOverride?.trim();
  if (override !== undefined && override !== "") {
    contactForService = override;
  } else if (input.noticeUrl !== "") {
    const detail = await fetchNoticeDetail(new Fetcher(), input.noticeUrl);
    if (detail.ok && detail.value !== undefined) {
      contactForService = detail.value.contactForService;
      claimDeadline = detail.value.claimDeadline;
    } else if (/robots/i.test(detail.reason)) {
      // The Gazette's own robots.txt forbids reading its notice data
      // automatically, and we obey it. Not an error to fix — the operator opens
      // the notice (permitted) and pastes the office-holder's address.
      note =
        "The Gazette does not allow its notice data to be read automatically. Open the notice (one tap) and paste the office-holder's address below — it will fill into the letter.";
    } else {
      // Any other failure (a 404, a redirect, a non-JSON body): surface the
      // real reason so it is clear whether the notice or our read of it is at fault.
      note = `The notice could not be read — ${detail.reason} Open it directly, and paste the contact below.`;
    }
  }

  const letter =
    input.kind === "owner-insolvent"
      ? draftInsolvencyLetter({
          sender,
          ...(contactForService !== undefined ? { officeHolder: contactForService } : {}),
          ...(input.court !== undefined && input.court !== "" ? { court: input.court } : {}),
          debtorName: input.subjectName,
          ...(input.propertyAddress !== "" ? { propertyAddress: input.propertyAddress } : {}),
          today,
        })
      : draftProbateLetter({
          sender,
          ...(contactForService !== undefined ? { recipientContact: contactForService } : {}),
          deceasedName: input.subjectName,
          ...(input.propertyAddress !== "" ? { propertyAddress: input.propertyAddress } : {}),
          ...(claimDeadline !== undefined ? { claimDeadline } : {}),
          today,
        });

  return {
    ok: contactForService !== undefined,
    ...(contactForService !== undefined ? { contactForService } : {}),
    letter,
    ...(note !== undefined ? { message: note } : {}),
  };
}

export interface LeadEnrichment {
  readonly propertyType?: string;
  readonly tenure?: "freehold" | "leasehold";
  readonly floorAreaSqm?: number;
  /** The last registered sale, in whole pounds, as a value anchor. */
  readonly lastSoldPounds?: number;
  readonly lastSoldAt?: string;
  readonly notes: readonly string[];
}

/**
 * Enrich a lead's address from the EPC register and Price Paid, on demand.
 *
 * The Gazette carries no property attributes, so these come from the open
 * registers matched to the address: the type and floor area from the EPC, the
 * tenure and the last sold price from Land Registry. Nothing is invented — a
 * miss is a field the operator fills. Checks its own permission (§29).
 */
export async function enrichLead(input: {
  readonly address: string;
  readonly postcode: string;
}): Promise<LeadEnrichment> {
  await requirePermission("manage-mandates", "/operator/sourcing");
  const e = await enrichAddress(input.address, input.postcode);
  return {
    ...(e.propertyType !== undefined ? { propertyType: e.propertyType } : {}),
    ...(e.tenure !== undefined ? { tenure: e.tenure } : {}),
    ...(e.floorAreaSqm !== undefined ? { floorAreaSqm: e.floorAreaSqm } : {}),
    ...(e.lastSoldPrice !== undefined ? { lastSoldPounds: Math.round(Number(e.lastSoldPrice) / 100) } : {}),
    ...(e.lastSoldAt !== undefined ? { lastSoldAt: e.lastSoldAt } : {}),
    notes: e.notes,
  };
}

/**
 * Turn a probate lead into a deal in the pipeline.
 *
 * The bridge from lead to deal, so the operator does not re-key an address the
 * platform already holds. It creates a real deal at status "new" and lands on
 * the seller-checks step — because the next thing that must happen is proving
 * who owns it and whether they may sell (the grant of probate on a probate lead;
 * the registered proprietor on a prepared-but-unsold one), which is where these
 * deals succeed or fail.
 *
 * The one figure that cannot be defaulted is the value, so the operator gives
 * it — nothing is fabricated. Inventory is deliberately left unconfirmed: a
 * signal is not the verified authority to sell, and that verification is exactly
 * the step this lands on. A server action is its own POST endpoint, so it checks
 * its own permission (§29).
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
  // The one line that drives verification: a title number. It is optional —
  // a deal starts without it — but given one, the register names the owner and
  // that name is screened, both folded into the seller checks below.
  const titleNumber = String(formData.get("titleNumber") ?? "").trim();
  const signal = String(formData.get("signal") ?? "probate-notice");
  const pounds = Number(formData.get("estimatedValue"));
  const propertyTypeRaw = String(formData.get("propertyType") ?? "");
  const jurisdictionRaw = String(formData.get("jurisdiction") ?? "GB-ENG");

  // The seller situation the deal starts in, by the signal it came from. A
  // prepared-but-unsold property is a failed/stale listing; a Gazette notice is
  // probate. Both land on seller-checks: ownership and authority to sell must be
  // proved before any approach, which is exactly where these deals succeed or
  // fail.
  const isPrepared = signal === "prepared-but-unsold";
  const situation: SellerSituation = isPrepared ? "failed-listing" : "probate";
  const narrative = isPrepared
    ? `Started from a prepared-but-unsold signal: an EPC was lodged and no sale has been registered since.${address !== "" ? ` Property: ${address}.` : ""} Confirm the registered owner on the title before any approach.`
    : `Started from a Gazette probate notice.${subjectName !== "" ? ` Estate of ${subjectName}.` : ""}${address !== "" ? ` Property: ${address}.` : ""}${contact !== "" ? ` Contact for service: ${contact}.` : ""}`;

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
  const tenureRaw = String(formData.get("tenure") ?? "freehold");
  const tenure: Tenure = TENURES.has(tenureRaw as Tenure) ? (tenureRaw as Tenure) : "freehold";

  // Locality: the town, taken as the last address segment that is not the
  // postcode. Best-effort; the operator can refine it on the deal.
  const outward = postcode.split(" ")[0] ?? postcode;
  const segments = address
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "" && !s.toUpperCase().startsWith(outward));
  const locality = (segments[segments.length - 1] ?? "").slice(0, 80);

  const answers: IntakeAnswers = {
    situation,
    priorities: ["certainty"],
    narrative,
    postcodeArea: postcode.slice(0, 8),
    locality,
    jurisdiction,
    propertyType,
    tenure,
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

  // Verify id and address from the one line. The register names the owner and
  // that name is screened; with no key configured every part comes back
  // inconclusive and writes nothing, so the deal still starts — the seller
  // simply reads as unchecked, which is the correct and honest default.
  const verification = await runCounterpartyVerification({
    dealId: id,
    ...(titleNumber !== "" ? { titleNumber } : {}),
    requestedBy: author?.name ?? "operator",
  });
  const sellerChecks: SellerDueDiligence | undefined =
    Object.keys(verification.sellerUpdate).length > 0
      ? { kind: "individual", ...verification.sellerUpdate }
      : undefined;

  await saveDeal({
    id,
    reference: `LODE-${dealReference()}`,
    createdAt: new Date().toISOString(),
    property: intake.property,
    seller: intake.seller,
    origin: { via: "sourcing", note: signal, at: new Date().toISOString() },
    ...(sellerChecks !== undefined ? { sellerChecks } : {}),
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
    detail: isPrepared
      ? `Started from a prepared-but-unsold lead${address !== "" ? ` (${address})` : ""} at ${postcode}.`
      : `Started from a probate lead${subjectName !== "" ? ` (estate of ${subjectName})` : ""} at ${postcode}.`,
  });

  // Now that it is a deal in the pipeline, suppress the raw lead from future
  // runs — the same key printing uses, so a lead already being worked does not
  // reappear in the search. Best-effort: a suppression miss must not undo a
  // created deal, and it is idempotent if the lead was already contacted.
  if (LEAD_SIGNALS.has(signal as LeadSignal)) {
    const key = leadContactKey({
      signalKey: signal as LeadSignal,
      ...(formData.get("addressKey") ? { addressKey: String(formData.get("addressKey")) } : {}),
      ...(formData.get("sourceUrl") ? { sourceUrl: String(formData.get("sourceUrl")) } : {}),
    });
    if (key !== undefined) {
      // Keep the same three facts the print path keeps, so if this lead is later
      // restored it still offers "Start a deal" from the Contacted list.
      const startFacts = {
        ...(postcode !== "" ? { postcode } : {}),
        ...(address !== "" ? { address } : {}),
        ...(subjectName !== "" ? { subjectName } : {}),
      };
      await markContactedLead({
        key,
        signalKey: signal as LeadSignal,
        contactedAt: new Date().toISOString(),
        by: author?.email ?? "operator",
        ...(Object.keys(startFacts).length > 0 ? { startFacts } : {}),
      }).catch(() => undefined);
    }
  }

  redirect(`/deals/${id}/seller-checks`);
}

export async function runRegistersAction(
  _previous: SourcingResult | undefined,
  _formData: FormData,
): Promise<SourcingResult> {
  const viewer = await requirePermission("manage-mandates", "/operator/sourcing");
  const author = viewerAccount(viewer);

  // How many notices to gather per kind. Higher means more pages fetched, so
  // more priority-area (Midlands) leads surface in a national feed — the default
  // is a middle ground, raise it with GAZETTE_MAX_NOTICES.
  const maxNotices = Number(process.env.GAZETTE_MAX_NOTICES) || 120;
  const result = await runRegisters({
    maxNotices,
    ...(process.env.GAZETTE_DECEASED_CODE !== undefined ? { deceasedCode: process.env.GAZETTE_DECEASED_CODE } : {}),
    ...(process.env.GAZETTE_INSOLVENCY_CODE !== undefined ? { insolvencyCode: process.env.GAZETTE_INSOLVENCY_CODE } : {}),
  });

  // A notice already written to (its office-holder) does not come back: the
  // suppression is keyed by the notice's own public URL, the one stable id these
  // live leads carry. Nothing about the person is stored to do this.
  const contacted = new Set((await listContactedLeads()).map((c) => c.key));
  const leads = result.leads.filter((lead) => {
    const key = leadContactKey(lead);
    return key === undefined || !contacted.has(key);
  });

  await audit("mandate-saved", {
    ...(author !== undefined ? { account: author } : {}),
    subject: "sourcing-run-registers",
    detail: `Register run: ${result.requestsMade} request(s), ${leads.length} lead(s). ${result.notes.join(" ")}`,
  });

  return {
    ok: leads.length > 0,
    message:
      leads.length > 0
        ? `${leads.length} lead(s) from the public registers in ${result.requestsMade} request(s).`
        : "No leads. The registers were not reachable from here, or no notice code is configured — see the notes.",
    leads,
    flips: [],
    notes: result.notes,
  };
}

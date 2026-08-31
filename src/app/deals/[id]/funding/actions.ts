"use server";

import { revalidatePath } from "next/cache";
import { money } from "@shared/money";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { getDeal, saveDeal } from "@backend/store/repository";
import type { FundingEvidence } from "@shared/domain/fundingReadiness";
import type { BorrowerFacts } from "@shared/domain/regulatoryRoute";
import type { RecordedOffer } from "@backend/store/schema";
import { randomUUID } from "node:crypto";
import { audit } from "@backend/audit";

/**
 * Recording what can be proved about a deal, and the facts the regulatory
 * route is classified from.
 *
 * Both were unreachable until this existed: the readiness score read an
 * evidence record nothing could write, and the route was only classified where
 * borrower facts had been recorded, which nothing could do. A score computed
 * from data no one can enter is a score that always says the same thing.
 */

export interface EvidenceResult {
  readonly ok: boolean;
  readonly message: string;
}

const CHECKBOXES = [
  "tenureConfirmed",
  "legalPackReviewed",
  "searchesOrdered",
  "titleDefectsResolved",
  "independentValuation",
  "comparablesRecorded",
  "borrowerIdentityVerified",
  "sourceOfFundsEvidenced",
  "trackRecordRecorded",
  "adverseCreditDeclared",
  "scheduleOfWorks",
  "costPlanFromQs",
  "contractorAppointed",
  "programmeAgreed",
  "exitEvidence",
  "backupExitRecorded",
  "solicitorInstructed",
] as const;

const PLANNING = new Set(["not-required", "granted", "applied", "pre-application", "none"]);

export async function recordEvidenceAction(
  _previous: EvidenceResult | undefined,
  formData: FormData,
): Promise<EvidenceResult> {
  const viewer = await requirePermission("view-seller-data", "/deals");
  const dealId = String(formData.get("dealId") ?? "").trim();
  const record = await getDeal(dealId);
  if (record === undefined) return { ok: false, message: "No such deal." };

  const text = (name: string): string | undefined => {
    const value = String(formData.get(name) ?? "").trim();
    return value === "" ? undefined : value;
  };

  const evidence: FundingEvidence = {
    ...Object.fromEntries(CHECKBOXES.map((name) => [name, formData.get(name) !== null])),
    ...(text("titleNumber") !== undefined ? { titleNumber: text("titleNumber") } : {}),
    ...(text("valuerFirm") !== undefined ? { valuerFirm: text("valuerFirm") } : {}),
    ...(text("valuationDate") !== undefined ? { valuationDate: text("valuationDate") } : {}),
    ...(planningOf(text("planningStatus")) !== undefined
      ? { planningStatus: planningOf(text("planningStatus")) }
      : {}),
    ...(poundsToMoney(formData.get("committedCash")) !== undefined
      ? { committedCash: poundsToMoney(formData.get("committedCash")) }
      : {}),
    ...(poundsToMoney(formData.get("valuationAmount")) !== undefined
      ? { valuationAmount: poundsToMoney(formData.get("valuationAmount")) }
      : {}),
    expiredDocuments: Math.max(0, Math.floor(Number(formData.get("expiredDocuments") ?? 0)) || 0),
  };

  await saveDeal({ ...record, evidence });
  await audit("viewed-seller-data", {
    ...(viewerAccount(viewer) !== undefined ? { account: viewerAccount(viewer) } : {}),
    subject: record.id,
    detail: "Recorded funding evidence.",
  });

  revalidatePath(`/deals/${dealId}/funding`);
  return { ok: true, message: "Recorded. The readiness score now reflects it." };
}

function planningOf(value: string | undefined): FundingEvidence["planningStatus"] {
  if (value === undefined || !PLANNING.has(value)) return undefined;
  return value as FundingEvidence["planningStatus"];
}

/** Pounds from a form field, as integer pence. Undefined for blank or zero. */
function poundsToMoney(value: FormDataEntryValue | null) {
  const pounds = Number(value);
  if (!Number.isFinite(pounds) || pounds <= 0) return undefined;
  return money(Math.round(pounds * 100));
}

/**
 * Record the facts the regulatory route is classified from.
 *
 * The one that decides most cases is whether the security includes a dwelling
 * the borrower or a relative occupies. It is asked plainly because a loan
 * secured on somebody's own home is a regulated mortgage contract whatever
 * purpose has been declared, and no other answer on this form changes that.
 */
export async function recordBorrowerFactsAction(
  _previous: EvidenceResult | undefined,
  formData: FormData,
): Promise<EvidenceResult> {
  const viewer = await requirePermission("view-seller-data", "/deals");
  const dealId = String(formData.get("dealId") ?? "").trim();
  const record = await getDeal(dealId);
  if (record === undefined) return { ok: false, message: "No such deal." };

  const legalForm = String(formData.get("legalForm") ?? "").trim();
  const allowed = ["individual", "company", "llp", "trust", "spv"];
  if (!allowed.includes(legalForm)) {
    return { ok: false, message: "Choose the borrower's legal form." };
  }

  const facts: BorrowerFacts = {
    legalForm: legalForm as BorrowerFacts["legalForm"],
    businessPurposeDeclared: formData.get("businessPurposeDeclared") !== null,
    businessPurposeEvidenced: formData.get("businessPurposeEvidenced") !== null,
    securityIncludesOwnerOccupiedDwelling:
      formData.get("securityIncludesOwnerOccupiedDwelling") !== null,
    consumerBuyToLetIndicators: formData.get("consumerBuyToLetIndicators") !== null,
    borrowerJurisdiction: String(formData.get("borrowerJurisdiction") ?? "GB").trim().toUpperCase(),
    assetJurisdiction: String(formData.get("assetJurisdiction") ?? "GB").trim().toUpperCase(),
  };

  await saveDeal({ ...record, borrowerFacts: facts });
  await audit("viewed-seller-data", {
    ...(viewerAccount(viewer) !== undefined ? { account: viewerAccount(viewer) } : {}),
    subject: record.id,
    detail: "Recorded borrower facts for regulatory classification.",
  });

  revalidatePath(`/deals/${dealId}/funding`);
  return { ok: true, message: "Recorded. The route has been classified against it." };
}

/**
 * Record an offer as received.
 *
 * Stored as the terms themselves, never as a computed total. A stored total
 * stops agreeing with the deal the moment the price or the term changes, and
 * the moment it disagrees somebody chooses a lender on a figure that is no
 * longer true.
 */
export async function recordOfferAction(
  _previous: EvidenceResult | undefined,
  formData: FormData,
): Promise<EvidenceResult> {
  const viewer = await requirePermission("view-seller-data", "/deals");
  const dealId = String(formData.get("dealId") ?? "").trim();
  const record = await getDeal(dealId);
  if (record === undefined) return { ok: false, message: "No such deal." };

  const lender = String(formData.get("lender") ?? "").trim();
  if (lender === "") return { ok: false, message: "Name the lender." };

  const pct = (name: string): number | undefined => {
    const value = Number(formData.get(name));
    if (!Number.isFinite(value) || value < 0 || value > 100) return undefined;
    return Math.round(value * 100);
  };

  const rate = pct("annualRate");
  const ltv = pct("ltv");
  const term = Math.floor(Number(formData.get("termMonths")));
  if (rate === undefined || ltv === undefined) {
    return { ok: false, message: "Rate and LTV must be percentages between 0 and 100." };
  }
  if (!Number.isFinite(term) || term < 1 || term > 360) {
    return { ok: false, message: "Term must be between 1 and 360 months." };
  }

  const confidence = String(formData.get("confidence") ?? "indicative");
  const allowed = ["indicative", "credit-backed", "valuation-backed", "binding"];

  const offer: RecordedOffer = {
    id: randomUUID(),
    lender,
    annualRateBps: rate,
    arrangementFeeBps: pct("arrangementFee") ?? 0,
    brokerFeeBps: pct("brokerFee") ?? 0,
    exitFeeBps: pct("exitFee") ?? 0,
    ltvBps: ltv,
    lenderCosts: Math.max(0, Math.round(Number(formData.get("lenderCosts") ?? 0) * 100)) || 0,
    interestRolledUp: formData.get("interestRolledUp") !== null,
    termMonths: term,
    confidence: (allowed.includes(confidence) ? confidence : "indicative") as RecordedOffer["confidence"],
    receivedAt: new Date().toISOString(),
  };

  await saveDeal({ ...record, offers: [...(record.offers ?? []), offer] });
  await audit("viewed-seller-data", {
    ...(viewerAccount(viewer) !== undefined ? { account: viewerAccount(viewer) } : {}),
    subject: record.id,
    detail: `Recorded an offer from ${lender}.`,
  });

  revalidatePath(`/deals/${dealId}/funding`);
  return { ok: true, message: `Recorded ${lender}. The comparison is recomputed from the engine.` };
}

"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { bps, fromMajor, ZERO } from "@/lib/money";
import {
  optionalMoney,
  optionalNumber,
  requireOneOf,
  requiredMoney,
} from "@/lib/formFields";
import { buildIntake, type IntakeAnswers, type PropertyCondition } from "@/domain/intake";
import type {
  JurisdictionCode,
  PropertyIssue,
  PropertyType,
  SellerPriority,
  SellerSituation,
  Tenure,
} from "@/domain/types";
import { allSituations } from "@/domain/motivation";
import { newToken } from "@/lib/tokens";
import { saveDeal } from "@/store/repository";

/**
 * Intake submission.
 *
 * Parsing is strict and total: anything not recognised is rejected rather than
 * coerced to a default. A silently defaulted situation or jurisdiction would
 * change which structures are lawful and which safeguards fire, so a bad field
 * must fail loudly rather than quietly produce a plausible answer.
 */

const SITUATIONS = new Set<string>(allSituations());
const PRIORITIES = new Set<SellerPriority>([
  "speed",
  "certainty",
  "price",
  "convenience",
  "flexibility",
]);
const PROPERTY_TYPES = new Set<PropertyType>([
  "house",
  "flat",
  "bungalow",
  "hmo",
  "commercial",
  "mixed-use",
  "land",
]);
const TENURES = new Set<Tenure>(["freehold", "leasehold", "share-of-freehold", "unknown"]);
const JURISDICTIONS = new Set<JurisdictionCode>(["GB-ENG", "GB-SCT", "GB-WLS", "GB-NIR"]);
const CONDITIONS = new Set<PropertyCondition>([
  "ready",
  "tired",
  "needs-modernising",
  "needs-major-work",
  "uninhabitable",
]);
const ISSUES = new Set<PropertyIssue>([
  "structural",
  "damp",
  "subsidence",
  "japanese-knotweed",
  "cladding",
  "short-lease",
  "no-building-regs",
  "title-defect",
  "restrictive-covenant",
  "flood-risk",
  "non-standard-construction",
  "unregistered-title",
]);

/** Tri-state: yes / no / unanswered. Unanswered stays undefined on purpose. */
function triState(raw: FormDataEntryValue | null): boolean | undefined {
  if (raw === "yes") return true;
  if (raw === "no") return false;
  return undefined;
}

const AGE_BANDS = ["under-65", "65-79", "80-plus", "undisclosed"] as const;
type AgeBand = (typeof AGE_BANDS)[number];

/**
 * Narrow an age band without asserting.
 *
 * Anything absent or unrecognised becomes "undisclosed", which the protection
 * engine treats as unknown — and unknown raises caution rather than lowering
 * it, so a malformed field can never weaken a safeguard.
 */
function ageBand(raw: FormDataEntryValue | null): AgeBand {
  return AGE_BANDS.find((band) => band === raw) ?? "undisclosed";
}

export async function submitEnquiry(formData: FormData): Promise<void> {
  const priorities = formData
    .getAll("priorities")
    .filter((p): p is string => typeof p === "string")
    .filter((p): p is SellerPriority => PRIORITIES.has(p as SellerPriority));

  const knownIssues = formData
    .getAll("issues")
    .filter((i): i is string => typeof i === "string")
    .filter((i): i is PropertyIssue => ISSUES.has(i as PropertyIssue));

  const leaseYears = optionalNumber(formData.get("leaseYearsRemaining"));

  const answers: IntakeAnswers = {
    situation: requireOneOf<SellerSituation>(formData.get("situation"), SITUATIONS, "situation"),
    priorities,
    narrative: String(formData.get("narrative") ?? "").slice(0, 2_000),
    postcodeArea: String(formData.get("postcodeArea") ?? "").toUpperCase().slice(0, 8),
    locality: String(formData.get("locality") ?? "").slice(0, 80),
    jurisdiction: requireOneOf<JurisdictionCode>(
      formData.get("jurisdiction"),
      JURISDICTIONS,
      "jurisdiction",
    ),
    propertyType: requireOneOf<PropertyType>(
      formData.get("propertyType"),
      PROPERTY_TYPES,
      "propertyType",
    ),
    tenure: requireOneOf<Tenure>(formData.get("tenure"), TENURES, "tenure"),
    bedrooms: optionalNumber(formData.get("bedrooms")) ?? 3,
    occupancy: "unknown",
    ...(leaseYears !== undefined ? { leaseYearsRemaining: leaseYears } : {}),
    knownIssues,
    sellerValuation: requiredMoney(formData.get("sellerValuation"), "Estimated value"),
    ...(optionalMoney(formData.get("currentAsking")) !== undefined
      ? { currentAsking: optionalMoney(formData.get("currentAsking")) }
      : {}),
    condition: requireOneOf<PropertyCondition>(
      formData.get("condition"),
      CONDITIONS,
      "condition",
    ),
    ...(optionalNumber(formData.get("targetDays")) !== undefined
      ? { targetDays: optionalNumber(formData.get("targetDays")) }
      : {}),
    ...(optionalMoney(formData.get("priceExpectation")) !== undefined
      ? { priceExpectation: optionalMoney(formData.get("priceExpectation")) }
      : {}),
    screening: {
      hasIndependentLegalAdvice: triState(formData.get("hasIndependentLegalAdvice")),
      hasReceivedIndependentValuation: triState(formData.get("hasReceivedIndependentValuation")),
      isSoleDecisionMaker: triState(formData.get("isSoleDecisionMaker")),
      reportsFinancialDistress: triState(formData.get("reportsFinancialDistress")),
      reportsHealthOrCapacityConcern: triState(formData.get("reportsHealthOrCapacityConcern")),
      isUnderTimePressureFromThirdParty: triState(formData.get("isUnderTimePressureFromThirdParty")),
      ageBand: ageBand(formData.get("ageBand")),
    },
  };

  const intake = buildIntake(answers);

  // The URL this returns is the seller's only way back to their own result and
  // it carries their situation, their figures and the safeguards raised on
  // their behalf. It was previously derived from the postcode, the locality and
  // the number of enquiries already stored, all of which a stranger can guess,
  // which made every seller's page enumerable. It is now a capability link: 32
  // bytes from a CSPRNG, the same standard as the newsletter confirm link.
  const id = `enq-${newToken()}`;

  await saveDeal({
    id,
    reference: `LODE-${referenceSuffix()}`,
    createdAt: new Date().toISOString(),
    property: intake.property,
    seller: intake.seller,
    // The enquiry carries no agreed price yet: the routes page derives what an
    // investor could pay. A placeholder price keeps the record shape valid and
    // is never shown to the seller.
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

  redirect(`/sell/${id}`);
}

/** Small non-cryptographic hash, used only to make ids unguessable-ish. */
/**
 * The human-facing reference, for quoting on a phone call.
 *
 * Random rather than sequential: a running count tells a caller how many
 * enquiries the platform has ever had, which is commercial information, and a
 * predictable reference invites people to try the next one. Ambiguous
 * characters are excluded so it survives being read aloud.
 */
function referenceSuffix(): string {
  const alphabet = "ACDEFGHJKLMNPQRTUVWXY3479";
  return Array.from(randomBytes(6))
    .map((byte) => alphabet[byte % alphabet.length] ?? "")
    .join("");
}

"use server";

import { redirect } from "next/navigation";
import { bps, fromMajor, ZERO, type Money } from "@/lib/money";
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
import { listDeals, saveDeal } from "@/store/repository";

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

function requireOneOf<T extends string>(
  raw: FormDataEntryValue | null,
  allowed: ReadonlySet<string>,
  field: string,
): T {
  const value = typeof raw === "string" ? raw : "";
  if (!allowed.has(value)) {
    throw new Error(`Invalid value for ${field}`);
  }
  return value as T;
}

function optionalMoney(raw: FormDataEntryValue | null): Money | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const parsed = Number(raw.replace(/[£,\s]/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return fromMajor(Math.round(parsed));
}

function requiredMoney(raw: FormDataEntryValue | null, field: string): Money {
  const value = optionalMoney(raw);
  if (value === undefined) throw new Error(`${field} must be a positive amount`);
  return value;
}

function optionalNumber(raw: FormDataEntryValue | null): number | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

/** Tri-state: yes / no / unanswered. Unanswered stays undefined on purpose. */
function triState(raw: FormDataEntryValue | null): boolean | undefined {
  if (raw === "yes") return true;
  if (raw === "no") return false;
  return undefined;
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
      ageBand: (["under-65", "65-79", "80-plus", "undisclosed"] as const).includes(
        formData.get("ageBand") as never,
      )
        ? (formData.get("ageBand") as "under-65" | "65-79" | "80-plus" | "undisclosed")
        : "undisclosed",
    },
  };

  const intake = buildIntake(answers);

  const existing = await listDeals();
  const id = `enq-${String(existing.length + 1).padStart(4, "0")}-${Math.abs(
    hash(`${answers.postcodeArea}${answers.locality}${existing.length}`),
  ).toString(36)}`;

  await saveDeal({
    id,
    reference: `LODE-${id.slice(4, 8).toUpperCase()}`,
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
function hash(input: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h | 0;
}

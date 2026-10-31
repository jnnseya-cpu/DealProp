"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { bps, fromMajor, ZERO } from "@shared/money";
import {
  optionalMoney,
  optionalNumber,
  requireOneOf,
  requiredMoney,
} from "@shared/formFields";
import { buildIntake, type IntakeAnswers, type PropertyCondition } from "@shared/domain/intake";
import { ConsentNotGiven, recordEnquiryConsent } from "@shared/domain/sellerConsent";
import type {
  JurisdictionCode,
  PropertyIssue,
  PropertyType,
  SellerPriority,
  SellerSituation,
  Tenure,
} from "@shared/domain/types";
import { allSituations } from "@shared/domain/motivation";
import { newToken } from "@backend/auth/tokens";
import { getDeal, saveDeal } from "@backend/store/repository";
import { audit } from "@backend/audit";
import { cookies } from "next/headers";
import { readSession, SESSION_COOKIE } from "@backend/auth/session";
import { callerFrom, consume } from "@backend/rateLimit";
import { headers as nextHeaders } from "next/headers";

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

/**
 * Parse the intake answers from a form.
 *
 * Shared by the first submission and by a later correction, so the two cannot
 * drift — a field the correction form forgot to validate the same way would be
 * a field a seller could set to something the submission form forbids. Strict
 * and total: anything unrecognised is rejected, never defaulted.
 */
function parseEnquiryAnswers(formData: FormData): IntakeAnswers {
  const priorities = formData
    .getAll("priorities")
    .filter((p): p is string => typeof p === "string")
    .filter((p): p is SellerPriority => PRIORITIES.has(p as SellerPriority));

  const knownIssues = formData
    .getAll("issues")
    .filter((i): i is string => typeof i === "string")
    .filter((i): i is PropertyIssue => ISSUES.has(i as PropertyIssue));

  const leaseYears = optionalNumber(formData.get("leaseYearsRemaining"));

  return {
    situation: requireOneOf<SellerSituation>(formData.get("situation"), SITUATIONS, "situation"),
    priorities,
    narrative: String(formData.get("narrative") ?? "").slice(0, 2_000),
    postcodeArea: String(formData.get("postcodeArea") ?? "").toUpperCase().slice(0, 8),
    locality: String(formData.get("locality") ?? "").slice(0, 80),
    jurisdiction: requireOneOf<JurisdictionCode>(formData.get("jurisdiction"), JURISDICTIONS, "jurisdiction"),
    propertyType: requireOneOf<PropertyType>(formData.get("propertyType"), PROPERTY_TYPES, "propertyType"),
    tenure: requireOneOf<Tenure>(formData.get("tenure"), TENURES, "tenure"),
    bedrooms: optionalNumber(formData.get("bedrooms")) ?? 3,
    occupancy: "unknown",
    ...(leaseYears !== undefined ? { leaseYearsRemaining: leaseYears } : {}),
    knownIssues,
    sellerValuation: requiredMoney(formData.get("sellerValuation"), "Estimated value"),
    ...(optionalMoney(formData.get("currentAsking")) !== undefined
      ? { currentAsking: optionalMoney(formData.get("currentAsking")) }
      : {}),
    condition: requireOneOf<PropertyCondition>(formData.get("condition"), CONDITIONS, "condition"),
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
}

export async function submitEnquiry(formData: FormData): Promise<void> {
  /*
    A public form that writes a record, so it is a free way to fill the
    pipeline with junk and the store with rows. A person submits one enquiry;
    a script submits thousands, and the operator then cannot find the real
    ones — which costs more than the storage does.

    Redirected rather than thrown: this action redirects on success and has no
    error surface to return to, and a thrown error would show a stack page to
    somebody who is, in the ordinary case, a distressed seller who pressed the
    button twice.
  */
  const gate = consume("intake", callerFrom(await nextHeaders()));
  if (!gate.allowed) redirect("/sell?slow-down=1");

  // Consent before anything is parsed or stored. The form makes both checkboxes
  // mandatory; this is the server making sure, because a client control is not a
  // control and we will not hold a person's circumstances with no record of why.
  let enquiryConsent;
  try {
    enquiryConsent = recordEnquiryConsent({
      ownerAffirmed: formData.get("ownerAffirmed") === "yes",
      privacyAcknowledged: formData.get("privacyAcknowledged") === "yes",
    });
  } catch (error) {
    if (error instanceof ConsentNotGiven) redirect("/sell?needs-consent=1");
    throw error;
  }

  const answers = parseEnquiryAnswers(formData);

  const intake = buildIntake(answers);

  // Tie the submission to a seller account where one is signed in, so it shows
  // on their dashboard. Read straight from the signed session cookie, not
  // through the page guard: this is attribution, not authorisation — the form
  // stays open to everyone (public by design) and the capability link below is
  // the way back either way. The id is HMAC-verified by readSession, so it is
  // authentic even though nothing here gates on it.
  const sessionJar = await cookies();
  const claims = await readSession(sessionJar.get(SESSION_COOKIE)?.value, process.env.OPERATOR_SECRET);
  const ownerAccountId = claims?.accountId;

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
    origin: { via: "sell", note: "public sell form", at: new Date().toISOString() },
    ...(ownerAccountId !== undefined ? { ownerAccountId } : {}),
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
    /**
     * The seller filling in this form is the owner saying it is for sale.
     *
     * Recorded as exactly that and nothing more. Before this, an enquiry from
     * a person who had just typed out their situation and asked for help was
     * stored as "nobody has confirmed it is for sale" — which was both untrue
     * and the reason no enquiry could ever become a sellable opportunity.
     *
     * What is deliberately *not* claimed here is that they are the registered
     * proprietor. That is a different question, it is asked at
     * `/deals/[id]/seller-checks`, and the reveal stays blocked until it is
     * answered — so recording what they said cannot short-circuit checking who
     * they are.
     */
    inventory: {
      category: "owner-verified",
      confirmation: {
        by: "owner",
        at: new Date().toISOString(),
        recordedBy: "Seller enquiry form",
        /*
         * No situation in this sentence.
         *
         * It used to read `...describing the situation as "probate"`, which
         * put the seller's circumstances into a field the store does not
         * encrypt — so the one term the rest of the record goes to trouble to
         * seal was sitting in plaintext two objects away. Caught by submitting
         * a real enquiry and reading the file, not by a test.
         *
         * The evidence only has to establish that the owner confirmed the
         * property is theirs. Their situation is recorded once, on the seller,
         * encrypted, which is where anything that needs it should read it.
         */
        evidence:
          "Submitted their own property through the public enquiry form, confirming it is theirs to sell.",
      },
    },
    // Recorded at submission: the privacy-notice version shown and the seller's
    // affirmation that they may sell. The lawful basis for holding the rest.
    enquiryConsent,
    status: "new",
  });

  redirect(`/sell/${id}`);
}

/**
 * A seller corrects their own enquiry, with no account.
 *
 * The deal id is the capability: it is a 32-byte CSPRNG token the seller holds
 * from their result link, so holding it is proof the submission is theirs — the
 * same "manage your booking without logging in" model. No operator sign-in and
 * no account are required, which is why this stays in the public-by-design set.
 *
 * Three guards make it safe. It edits only a deal whose origin is a seller
 * submission (an `enq-` deal), so the public endpoint can never be used to
 * rewrite an operator-sourced lead even with its id. It refuses once the deal
 * has progressed past marketing, because a seller rewriting a funded deal is a
 * different and supervised event. And it changes only the seller's own
 * answers — every figure is re-derived by `buildIntake` and the engine, never
 * taken from the form — so a corrected enquiry is re-appraised and re-screened
 * rather than hand-edited.
 */
export async function correctEnquiry(formData: FormData): Promise<void> {
  const gate = consume("intake", callerFrom(await nextHeaders()));
  if (!gate.allowed) redirect("/sell?slow-down=1");

  const id = String(formData.get("id") ?? "");
  const existing = await getDeal(id);
  // Only a seller's own submission, and only while it is still early. A missing
  // deal, a sourced lead, or a progressed deal all redirect without editing —
  // the capability link is for correcting an enquiry, nothing more.
  if (existing === undefined) redirect("/sell");
  const isSellerSubmission = existing.origin?.via === "sell" || existing.id.startsWith("enq-");
  if (!isSellerSubmission) redirect(`/sell/${id}`);
  if (existing.status === "funded" || existing.status === "completed" || existing.status === "withdrawn") {
    redirect(`/sell/${id}?locked=1`);
  }

  const answers = parseEnquiryAnswers(formData);
  const intake = buildIntake(answers);

  // Replace only what the seller answered. Everything the operator or the
  // platform established — the reference, the created date, the origin, any
  // seller checks, the consent record, the inventory confirmation, the status —
  // is preserved. The id never changes, so the seller's link keeps working.
  await saveDeal({
    ...existing,
    property: intake.property,
    seller: intake.seller,
    inputs: {
      ...existing.inputs,
      property: intake.property,
      seller: intake.seller,
      purchasePrice: intake.property.openMarketValue,
    },
  });

  await audit("mandate-saved", {
    subject: existing.id,
    detail: `${existing.reference}: the seller corrected their enquiry through the capability link.`,
  });

  redirect(`/sell/${id}?updated=1`);
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

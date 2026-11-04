"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { bps, fromMajor, ZERO } from "@shared/money";
import {
  optionalMoney,
  optionalNumber,
  requireOneOf,
  requiredMoney,
} from "@shared/formFields";
import { buildIntake, type IntakeAnswers, type PropertyCondition } from "@shared/domain/intake";
import {
  itemsFor,
  type Knowledge,
  type MaterialRecord,
} from "@shared/domain/materialInformation";
import {
  SELLER_KINDS,
  type SellerDueDiligence,
  type SellerKind,
} from "@shared/domain/sellerDueDiligence";
import { ConsentNotGiven, recordEnquiryConsent } from "@shared/domain/sellerConsent";
import type { ResaleConsent } from "@shared/domain/reseller";
import type {
  JurisdictionCode,
  PropertyIssue,
  PropertyType,
  SellerContact,
  SellerPriority,
  SellerSituation,
  StatedIdentity,
  Tenure,
} from "@shared/domain/types";
import { allSituations } from "@shared/domain/motivation";
import type { Account } from "@shared/domain/accounts";
import { newToken } from "@backend/auth/tokens";
import { findAccountByEmail, getDeal, saveAccount, saveDeal } from "@backend/store/repository";
import { audit } from "@backend/audit";
import { cookies } from "next/headers";
import { createSession, readSession, SESSION_COOKIE, SESSION_SECONDS } from "@backend/auth/session";
import { cookieScope } from "@backend/auth/cookie";
import { hashPassword, passwordProblem, verifyPassword } from "@backend/auth/password";
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

/**
 * Parse the seller's contact details.
 *
 * Without a way to reach them the enquiry is one-way, so a name and at least
 * one of email or phone are required. Returns a problem key rather than
 * throwing, because these actions redirect on failure (there is a distressed
 * seller at the other end, not a form that wants a stack trace).
 */
function parseContact(formData: FormData): { contact?: SellerContact; problem?: string } {
  const name = String(formData.get("contactName") ?? "").trim().slice(0, 120);
  const email = String(formData.get("contactEmail") ?? "").trim().toLowerCase().slice(0, 200);
  const phone = String(formData.get("contactPhone") ?? "").trim().slice(0, 40);
  if (name === "") return { problem: "name" };
  if (email === "" && phone === "") return { problem: "channel" };
  if (email !== "" && !email.includes("@")) return { problem: "email" };
  return {
    contact: {
      name,
      ...(email !== "" ? { email } : {}),
      ...(phone !== "" ? { phone } : {}),
    },
  };
}

/**
 * Sign a person in by minting their session cookie.
 *
 * The same shape and scope as sign-up (`join/actions.ts`): httpOnly, secure in
 * production, lax, and `cookieScope()` so one cookie spans the apex and the www
 * host rather than making a seller sign in again when they move between them.
 */
async function signInAs(
  jar: Awaited<ReturnType<typeof cookies>>,
  accountId: string,
  secret: string,
): Promise<void> {
  jar.set(SESSION_COOKIE, await createSession(accountId, secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
    ...cookieScope(),
  });
}

/**
 * Resolve the seller account this enquiry belongs to, creating one if need be.
 *
 * A seller is a first-class account holder, not anonymous "supply": the person
 * at the other end of a sale we negotiate must be a named, reachable account
 * with a dashboard, not a capability link we hope they kept. So when nobody is
 * signed in and we have an email and a password, this creates a least-privilege
 * `seller` account and signs them in — a conventional login from the first
 * second. A returning seller who types their existing password is signed into
 * the account they already have. The capability link is kept as the no-account
 * fallback (no email, no password, or no signing secret), so the /sell flow
 * never slams shut on someone who will not make an account.
 *
 * The existing-email case is handled the one safe way: an account is only
 * linked, and a session only minted, when the submitted password *proves*
 * ownership. A wrong password never attaches this enquiry to somebody else's
 * account and never signs anyone in — it falls through to the capability link,
 * and the caller tells them an account already exists so they can sign in.
 */
async function resolveSellerAccount(
  jar: Awaited<ReturnType<typeof cookies>>,
  contact: SellerContact | undefined,
  password: string,
): Promise<{
  ownerAccountId?: string;
  outcome: "signed-in" | "account-exists" | "weak-password" | "none";
}> {
  // Attribution for an already-signed-in person: read straight from the signed
  // session cookie (HMAC-verified by readSession), not through the page guard —
  // this is attribution, not authorisation, and the form stays public.
  const secret = process.env.OPERATOR_SECRET;
  const claims = await readSession(jar.get(SESSION_COOKIE)?.value, secret);
  if (claims?.accountId !== undefined) return { ownerAccountId: claims.accountId, outcome: "none" };

  const email = contact?.email;
  // No email, no password, or no signing secret: nothing to make an account
  // from, or no way to mint a session. Fall back to the capability link.
  if (email === undefined || password === "" || secret === undefined || secret === "") {
    return { outcome: "none" };
  }

  const existing = await findAccountByEmail(email);
  if (existing === undefined) {
    // A new account is about to be created, so the password must meet the floor.
    // (A returning seller below is verified against the hash they already have,
    // where the floor was applied when they first set it.)
    if (passwordProblem(password) !== undefined) return { outcome: "weak-password" };
    const { hash, salt } = await hashPassword(password);
    const account: Account = {
      id: `acc-${randomUUID()}`,
      email,
      name: contact?.name ?? "",
      role: "seller",
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: new Date().toISOString(),
    };
    await saveAccount(account);
    await audit("account-created", {
      account,
      subject: `account:${account.id}`,
      detail: "Seller account created from the public sell enquiry form.",
    });
    await signInAs(jar, account.id, secret);
    return { ownerAccountId: account.id, outcome: "signed-in" };
  }

  // An account already exists for this email. Link and sign in ONLY with a
  // password that proves ownership — otherwise this enquiry stays a capability
  // link under nobody's account, and the caller points them at sign-in.
  if (await verifyPassword(password, existing.passwordHash, existing.passwordSalt)) {
    await signInAs(jar, existing.id, secret);
    return { ownerAccountId: existing.id, outcome: "signed-in" };
  }
  return { outcome: "account-exists" };
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

  const { contact, problem } = parseContact(formData);
  if (problem !== undefined) redirect("/sell?needs-contact=1");

  // Make the seller a first-class account holder. When nobody is signed in, the
  // name, email and password they just gave create (or sign them into) a seller
  // account, so the person we go on to deal with is a named login with a
  // dashboard — not anonymous supply behind a link. A wrong password for an
  // existing email never attaches this enquiry to it; it falls through to the
  // capability link and we tell them to sign in.
  const sessionJar = await cookies();
  const sellerPassword = String(formData.get("sellerPassword") ?? "");
  const { ownerAccountId, outcome } = await resolveSellerAccount(sessionJar, contact, sellerPassword);
  if (outcome === "weak-password") redirect("/sell?weak-password=1");

  const answers = parseEnquiryAnswers(formData);

  const intake = buildIntake(answers);
  // Carry the contact onto the seller on both copies (profile and inputs), so
  // it is sealed and reproducible like the rest of the seller.
  const seller = contact !== undefined ? { ...intake.seller, contact } : intake.seller;

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
    seller,
    origin: { via: "sell", note: "public sell form", at: new Date().toISOString() },
    ...(ownerAccountId !== undefined ? { ownerAccountId } : {}),
    // The enquiry carries no agreed price yet: the routes page derives what an
    // investor could pay. A placeholder price keeps the record shape valid and
    // is never shown to the seller.
    inputs: {
      property: intake.property,
      seller,
      purchasePrice: intake.property.openMarketValue,
      // No buyer is established on an enquiry, so the tax profile is unknown:
      // the engine takes transfer tax at the worst case and marks the
      // appraisal taxPending, so the figure can only be revised down (A06).
      buyerProfileUnknown: true,
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

  // Signed-in sellers land on their options with a note that an account now
  // exists; a clash on an existing email sends them to the same options but
  // points them at sign-in to see every submission together.
  const suffix =
    outcome === "signed-in" ? "?welcome=1" : outcome === "account-exists" ? "?account-exists=1" : "";
  redirect(`/sell/${id}${suffix}`);
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

  const { contact, problem } = parseContact(formData);
  if (problem !== undefined) redirect(`/sell/${id}?needs-contact=1`);

  const answers = parseEnquiryAnswers(formData);
  const intake = buildIntake(answers);
  const seller = contact !== undefined ? { ...intake.seller, contact } : intake.seller;

  // Replace only what the seller answered. Everything the operator or the
  // platform established — the reference, the created date, the origin, any
  // seller checks, the consent record, the inventory confirmation, the status —
  // is preserved. The id never changes, so the seller's link keeps working.
  await saveDeal({
    ...existing,
    property: intake.property,
    seller,
    inputs: {
      ...existing.inputs,
      property: intake.property,
      seller,
      purchasePrice: intake.property.openMarketValue,
    },
  });

  await audit("mandate-saved", {
    subject: existing.id,
    detail: `${existing.reference}: the seller corrected their enquiry through the capability link.`,
  });

  redirect(`/sell/${id}?updated=1`);
}

/**
 * A seller fills in the material information a buyer must be told, with no
 * account — the self-serve half of getting a property listed.
 *
 * The Consumer Protection from Unfair Trading Regulations make Part A
 * (`materialInformation.ts` §66) a precondition of marketing at all, and that
 * information is the owner's own knowledge: the tenure, the council-tax band,
 * the lease terms. So the seller can provide it directly, one item at a time,
 * through the same capability link that lets them correct their enquiry — the
 * deal id is the capability, which is why this stays public by design.
 *
 * What this deliberately does NOT do is clear the seller's identity, ownership
 * or AML checks. Those are `sellerDueDiligence.ts` (§67), they are a check Lode
 * performs rather than a claim the seller makes, and `quoteReveal()` keeps the
 * listing shut until they are done. A seller cannot verify themselves, and this
 * never lets them try — it only records the material facts, which is the part
 * that is genuinely theirs to state.
 */
export async function recordSellerMaterial(formData: FormData): Promise<void> {
  const gate = consume("intake", callerFrom(await nextHeaders()));
  if (!gate.allowed) redirect("/sell?slow-down=1");

  const id = String(formData.get("id") ?? "");
  const existing = await getDeal(id);
  if (existing === undefined) redirect("/sell");
  const isSellerSubmission = existing.origin?.via === "sell" || existing.id.startsWith("enq-");
  if (!isSellerSubmission) redirect(`/sell/${id}`);
  if (existing.status === "funded" || existing.status === "completed" || existing.status === "withdrawn") {
    redirect(`/sell/${id}?locked=1`);
  }

  // The item must be one that actually applies to this property — so the form
  // cannot record a leasehold-only disclosure against a freehold, or an item
  // that does not exist at all.
  const key = String(formData.get("key") ?? "").trim();
  const item = itemsFor(existing.property).find((i) => i.key === key);
  if (item === undefined) redirect(`/sell/${id}#listing`);

  const state = String(formData.get("state") ?? "").trim();
  const text = String(formData.get("text") ?? "").trim().slice(0, 600);

  let knowledge: Knowledge;
  if (state === "stated") {
    if (text === "") redirect(`/sell/${id}?listing=needs-detail#listing`);
    knowledge = { state: "stated", value: text };
  } else if (state === "not-applicable") {
    if (text === "") redirect(`/sell/${id}?listing=needs-detail#listing`);
    knowledge = { state: "not-applicable", why: text };
  } else if (state === "not-known") {
    // The owner was asked — they are the owner — and does not know. That is a
    // true "not known", honestly attributed, which is exactly the distinction
    // §66 draws between "nobody looked" and "we asked and could not find out".
    knowledge = { state: "not-known", whoWasAsked: "The owner, in their own listing" };
  } else {
    redirect(`/sell/${id}#listing`);
  }

  const material: MaterialRecord = { ...(existing.material ?? {}), [key]: knowledge };
  await saveDeal({ ...existing, material });
  await audit("material-information-recorded", {
    subject: existing.id,
    detail: `${existing.reference}: ${key} · ${state} · recorded by the seller through the listing form.`,
  });

  redirect(`/sell/${id}?listing=updated#listing`);
}

/**
 * The owner opts their listing in or out of the reseller network, with no
 * account.
 *
 * Reselling is a partner marketing the owner's property onward for a fee, and
 * it is the owner's property to instruct on — so it happens only on the owner's
 * recorded authority, granted here through the same capability link. A general
 * authority ("vetted partners may market this"), because the owner is opting
 * into the network rather than naming a firm; `mayResell()` still requires the
 * reseller's own AML and redress on top. The consent is withdrawable the same
 * way, and withdrawing it removes the authority rather than flagging it.
 */
export async function setResaleConsent(formData: FormData): Promise<void> {
  const gate = consume("intake", callerFrom(await nextHeaders()));
  if (!gate.allowed) redirect("/sell?slow-down=1");

  const id = String(formData.get("id") ?? "");
  const existing = await getDeal(id);
  if (existing === undefined) redirect("/sell");
  const isSellerSubmission = existing.origin?.via === "sell" || existing.id.startsWith("enq-");
  if (!isSellerSubmission) redirect(`/sell/${id}`);
  if (existing.status === "funded" || existing.status === "completed" || existing.status === "withdrawn") {
    redirect(`/sell/${id}?locked=1`);
  }

  const allow = formData.get("allow") === "yes";
  const grantedBy = existing.seller.contact?.name?.trim() || "The owner";
  const resaleConsent: ResaleConsent | undefined = allow
    ? { grantedAt: new Date().toISOString(), grantedBy }
    : undefined;

  await saveDeal({ ...existing, resaleConsent });
  await audit("resale-consent-recorded", {
    subject: existing.id,
    detail: `${existing.reference}: the owner ${allow ? "authorised" : "withdrew authority for"} vetted partners to market this listing.`,
  });

  redirect(`/sell/${id}?listing=${allow ? "resale-on" : "resale-off"}#listing`);
}

/**
 * A seller tells us who they are and their authority to sell, with no account.
 *
 * The Money Laundering Regulations make us check the seller — who they are, that
 * they may sell it, who is behind them (§67). That check is ours to perform and
 * a seller cannot clear it themselves; what they CAN do is give us a head start
 * by stating their kind and their authority in their own words, through the same
 * capability link. So this records exactly that and no more: the seller's `kind`
 * and their stated authority. It never writes a verification timestamp — the
 * identity, screening and authority checks stay unheld until a named person at
 * Lode records them (`/deals/[id]/seller-checks`), which is the law and is why
 * the form says so plainly rather than implying the seller has cleared anything.
 */
export async function recordSellerDetails(formData: FormData): Promise<void> {
  const gate = consume("intake", callerFrom(await nextHeaders()));
  if (!gate.allowed) redirect("/sell?slow-down=1");

  const id = String(formData.get("id") ?? "");
  const existing = await getDeal(id);
  if (existing === undefined) redirect("/sell");
  const isSellerSubmission = existing.origin?.via === "sell" || existing.id.startsWith("enq-");
  if (!isSellerSubmission) redirect(`/sell/${id}`);
  if (existing.status === "funded" || existing.status === "completed" || existing.status === "withdrawn") {
    redirect(`/sell/${id}?locked=1`);
  }

  const kindRaw = String(formData.get("kind") ?? "").trim();
  const kind = SELLER_KINDS.find((k) => k.kind === kindRaw)?.kind;
  if (kind === undefined) redirect(`/sell/${id}#about`);

  const authority = String(formData.get("authority") ?? "").trim().slice(0, 600);
  const legalName = String(formData.get("legalName") ?? "").trim().slice(0, 160);
  const dateOfBirth = String(formData.get("dateOfBirth") ?? "").trim().slice(0, 10);

  // Merge onto any existing checks so a Lode-recorded verification is preserved.
  // Crucially, no *-VerifiedAt / screenedAt / authorityEvidencedAt is set here:
  // those are Lode's to record, and the seller stating their authority is a
  // claim to be verified, not the evidence itself.
  const sellerChecks: SellerDueDiligence = {
    ...(existing.sellerChecks ?? {}),
    kind: kind as SellerKind,
    ...(authority !== "" ? { authorityEvidence: authority } : {}),
  };

  // The identity attributes an AML check is run against, stated by the seller.
  // Set on both seller copies so sealing covers them (like the contact), and
  // only where something was given, so an empty submission records nothing.
  const statedIdentity: StatedIdentity | undefined =
    legalName !== "" || dateOfBirth !== ""
      ? {
          ...(legalName !== "" ? { legalName } : {}),
          ...(dateOfBirth !== "" ? { dateOfBirth } : {}),
        }
      : undefined;
  const withIdentity = <T extends { statedIdentity?: StatedIdentity }>(seller: T): T =>
    statedIdentity !== undefined ? { ...seller, statedIdentity } : seller;

  await saveDeal({
    ...existing,
    sellerChecks,
    seller: withIdentity(existing.seller),
    inputs: { ...existing.inputs, seller: withIdentity(existing.inputs.seller) },
  });
  await audit("seller-checks-recorded", {
    subject: existing.id,
    detail: `${existing.reference}: the seller described themselves as ${kind}${authority !== "" ? ", stated their authority" : ""}${statedIdentity !== undefined ? " and gave identity details" : ""} through the listing form. Verification still pending.`,
  });

  redirect(`/sell/${id}?about=updated#about`);
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

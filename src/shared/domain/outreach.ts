/**
 * Finding capital, and contacting it lawfully.
 *
 * The specification asks for an agent that discovers funders and writes to
 * them. Two halves, and only one of them belongs in application code.
 *
 * **Discovery** is a data-licensing question before it is an engineering one.
 * This codebase already refuses to take data without a recorded licence
 * (`sources.ts`), and the specification agrees: respect robots directives,
 * source terms and rate limits; never bypass logins, CAPTCHAs or paid access;
 * never infer private email addresses. So the connectors are gated by the
 * existing licence registry rather than written first and legalised later, and
 * a source with no recorded licence yields nothing.
 *
 * **Contact** is what this module governs, because it is where the platform can
 * do real harm on its own initiative. An agent that emails a few thousand
 * organisations without these gates commits an unlawful direct-marketing
 * campaign, possibly an unapproved financial promotion, in the operator's name
 * and at scale. Every send therefore passes an eligibility decision, and the
 * default is not to send.
 *
 * Nothing here sends anything. It decides whether sending would be lawful, and
 * says why not when it would not be.
 */

/* ------------------------------------------------------------ candidates */

/**
 * How far a discovered organisation has been checked.
 *
 * `UNVERIFIED` is deliberately the state of anything a model produced. A
 * plausible-looking address that nobody confirmed is the single most likely
 * thing an extraction agent will invent, and inventing a recipient means
 * writing to a stranger about somebody's property.
 */
export type VerificationStatus =
  | "VERIFIED"
  | "PARTIALLY_VERIFIED"
  | "STALE"
  | "CONFLICTING"
  | "REJECTED"
  | "UNVERIFIED";

/** Where one fact came from, kept per field rather than per record. */
export interface Provenance {
  readonly sourceKey: string;
  readonly sourceUrl?: string;
  /** ISO-8601. When the fact was actually observed, not when it was stored. */
  readonly observedAt: string;
  /** True where a model produced this rather than a source stating it. */
  readonly inferred: boolean;
}

export interface DiscoveredFact<T> {
  readonly value: T;
  readonly provenance: Provenance;
}

export type RecipientType =
  | "limited-company"
  | "llp"
  | "individual"
  | "sole-trader"
  | "partnership"
  | "unknown";

export interface Candidate {
  readonly id: string;
  readonly organisationName: string;
  readonly recipientType: RecipientType;
  readonly companyNumber?: DiscoveredFact<string>;
  readonly domain?: DiscoveredFact<string>;
  /** A published, organisation-level address. Never a guessed personal one. */
  readonly publishedEmail?: DiscoveredFact<string>;
  readonly enquiryFormUrl?: DiscoveredFact<string>;
  /**
   * An address for service, read from a record.
   *
   * Present where the recipient is reachable by post — which for a named
   * individual is the only lawful unsolicited channel.
   */
  readonly postalAddress?: DiscoveredFact<string>;
  readonly switchboard?: DiscoveredFact<string>;
  readonly mandateSummary?: DiscoveredFact<string>;
  readonly status: VerificationStatus;
  /** Last time the critical evidence was rechecked. */
  readonly verifiedAt?: string;
  /** Matched against a regulator warning list, sanctions or an insolvency record. */
  readonly warningFlags: readonly string[];
  readonly optedOut: boolean;
  readonly doNotContact: boolean;
}

/**
 * How long a verification is good for.
 *
 * A firm can be dissolved, cloned or added to a warning list between discovery
 * and outreach. Thirty days is short enough that a stale record is rechecked
 * before it is used, and the specification requires a recheck immediately
 * before introduction regardless.
 */
export const VERIFICATION_VALID_DAYS = 30;

export function verificationIsCurrent(candidate: Candidate, now: Date): boolean {
  if (candidate.verifiedAt === undefined) return false;
  const at = new Date(candidate.verifiedAt);
  if (Number.isNaN(at.getTime())) return false;
  return (now.getTime() - at.getTime()) / 86_400_000 <= VERIFICATION_VALID_DAYS;
}

/**
 * Merge what two sources say about one organisation.
 *
 * Provenance is never overwritten. Where sources disagree on a material fact
 * the record becomes `CONFLICTING` rather than one value silently winning —
 * conflicting contact details are the classic signature of a cloned firm, and
 * quietly picking the newer one is picking the clone.
 */
export function reconcile(existing: Candidate, incoming: Candidate): Candidate {
  const conflict =
    disagrees(existing.domain?.value, incoming.domain?.value) ||
    disagrees(existing.companyNumber?.value, incoming.companyNumber?.value);

  return {
    ...existing,
    ...incoming,
    // Opt-outs and warnings are sticky. A second source that does not mention
    // an opt-out is not evidence that it was withdrawn.
    optedOut: existing.optedOut || incoming.optedOut,
    doNotContact: existing.doNotContact || incoming.doNotContact,
    warningFlags: [...new Set([...existing.warningFlags, ...incoming.warningFlags])],
    status: conflict ? "CONFLICTING" : incoming.status,
  };
}

function disagrees(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return a.trim().toLowerCase() !== b.trim().toLowerCase();
}

/* ------------------------------------------------------------- messages */

export type MessageType =
  /** Anonymous: does this organisation look at deals of this shape at all. */
  | "mandate-enquiry"
  /** Named transaction, after interest is expressed. */
  | "borrower-introduction"
  /** An offer of credit. */
  | "credit-promotion"
  /** An offer of equity or a joint venture. A financial promotion. */
  | "investment-promotion";

export type OutreachDecision =
  | "SEND_ALLOWED"
  | "DRAFT_ONLY"
  | "CONSENT_REQUIRED"
  | "COMPLIANCE_APPROVAL_REQUIRED"
  | "PROMOTION_APPROVAL_REQUIRED"
  | "DO_NOT_CONTACT";

/**
 * How a message would reach the recipient.
 *
 * The distinction is not cosmetic. PECR governs *electronic* mail, so writing
 * to a named individual by email without consent is unlawful and writing to
 * them by post is not. A gate that refuses individuals regardless of channel
 * gets the law wrong in the safe direction — which sounds harmless until it
 * means the only lawful route to a homeowner is the one the platform will not
 * take.
 */
export type MessageChannel = "email" | "letter";

export interface OutreachContext {
  /** How this would be sent. Decides which rules apply. */
  readonly channel: MessageChannel;
  /** Consent recorded for electronic marketing, where one is needed. */
  readonly consentRecorded: boolean;
  /** An existing relationship supporting the soft opt-in, where relied on. */
  readonly softOptInApplies: boolean;
  /** A person has approved this specific message. */
  readonly complianceApproved: boolean;
  /** An authorised person has approved the promotion, or an exemption is recorded. */
  readonly promotionApproved: boolean;
  /** The recipient has previously been contacted about this deal. */
  readonly alreadyContactedForDeal: boolean;
  /** The deal owner has consented to identifying the property to this recipient. */
  readonly dealDisclosureConsent: boolean;
  /**
   * The three things a letter to a named individual needs before it goes.
   *
   * Direct mail to a person relies on legitimate interests rather than consent,
   * and legitimate interests is a test that has to be applied and recorded, not
   * asserted. The Mailing Preference Service is how somebody says in advance
   * that they do not want unaddressed approaches, and the privacy notice is how
   * they find out where their address came from.
   */
  readonly mpsScreened?: boolean;
  readonly privacyNoticeIncluded?: boolean;
  readonly legitimateInterestsRecorded?: boolean;
  readonly now: Date;
}

export interface EligibilityDecision {
  readonly decision: OutreachDecision;
  readonly maySend: boolean;
  readonly reason: string;
  readonly blockers: readonly string[];
}

/**
 * Whether this message may be sent to this recipient, now.
 *
 * Ordered so the answers that can never be overridden come first. An opt-out is
 * not a factor to weigh against a good match; it ends the question.
 *
 * The PECR distinction does most of the work: unsolicited electronic marketing
 * to an individual, sole trader or ordinary partnership needs consent or a
 * valid soft opt-in, while corporate subscribers may be written to provided the
 * sender is identified and an opt-out is offered. Getting the recipient type
 * wrong is how a lawful B2B campaign becomes an unlawful one, so `unknown`
 * counts as an individual rather than as a company.
 */
export function outreachEligibility(
  candidate: Candidate,
  message: MessageType,
  context: OutreachContext,
): EligibilityDecision {
  const blockers: string[] = [];

  if (candidate.doNotContact || candidate.optedOut) {
    return refuse(
      "DO_NOT_CONTACT",
      "This recipient has opted out or is on the do-not-contact list. That applies across every deal and campaign, immediately and permanently until they say otherwise.",
    );
  }

  if (candidate.warningFlags.length > 0) {
    return refuse(
      "DO_NOT_CONTACT",
      `Screening returned ${candidate.warningFlags.join(", ")}. Nothing is sent and a compliance case is opened instead.`,
    );
  }

  if (candidate.status === "REJECTED" || candidate.status === "CONFLICTING") {
    return refuse(
      "DO_NOT_CONTACT",
      candidate.status === "CONFLICTING"
        ? "The discovered contact details conflict with the official record. Conflicting details are the signature of a cloned firm, so this needs a person before anything is sent."
        : "This candidate was rejected at verification.",
    );
  }

  // The rule that stops an extraction agent inventing a recipient. A letter is
  // addressed from the register rather than from a published mailbox, so the
  // check is which detail the channel actually uses — not always the email.
  if (candidate.status === "UNVERIFIED") {
    return refuse(
      "DO_NOT_CONTACT",
      "Nothing about this recipient has been verified. A guessed or model-generated contact detail is never used — the recipient would be a stranger and the subject would be somebody's property.",
    );
  }
  if (context.channel === "email") {
    if (candidate.publishedEmail === undefined) {
      return refuse(
        "DO_NOT_CONTACT",
        "No verified, published email address. A guessed address is never sent to.",
      );
    }
    if (candidate.publishedEmail.provenance.inferred) {
      return refuse(
        "DO_NOT_CONTACT",
        "The contact address was inferred rather than published. Inferred addresses are not used for outreach at all.",
      );
    }
  }
  if (context.channel === "letter") {
    if (candidate.postalAddress === undefined) {
      return refuse(
        "DO_NOT_CONTACT",
        "No postal address on record. Nothing is inferred from the property address — the address for service is frequently different, and writing to the wrong one tells a stranger about somebody else's house.",
      );
    }
    if (candidate.postalAddress.provenance.inferred) {
      return refuse(
        "DO_NOT_CONTACT",
        "The postal address was inferred rather than read from a record. Inferred addresses are not written to.",
      );
    }
  }

  if (!verificationIsCurrent(candidate, context.now)) {
    blockers.push(
      `Verification is older than ${VERIFICATION_VALID_DAYS} days. Recheck the domain, regulatory status and warning lists before sending.`,
    );
    return {
      decision: "DRAFT_ONLY",
      maySend: false,
      reason: "The evidence behind this recipient is stale, so the message may be drafted but not sent.",
      blockers,
    };
  }

  // An investment promotion is the highest bar and never clears automatically.
  if (message === "investment-promotion") {
    return {
      decision: context.promotionApproved
        ? "COMPLIANCE_APPROVAL_REQUIRED"
        : "PROMOTION_APPROVAL_REQUIRED",
      maySend: false,
      reason:
        "An offer of equity or a joint venture is a financial promotion. It needs an approver or a recorded exemption, and the recipient's investor categorisation must be current before they see it.",
      blockers: [
        context.promotionApproved
          ? "Promotion approved; confirm this recipient's investor categorisation is current."
          : "Record the approval or the exemption relied on for this recipient.",
      ],
    };
  }

  const individual =
    candidate.recipientType === "individual" ||
    candidate.recipientType === "sole-trader" ||
    candidate.recipientType === "partnership" ||
    candidate.recipientType === "unknown";

  if (individual && context.channel === "email" && !context.consentRecorded && !context.softOptInApplies) {
    return {
      decision: "CONSENT_REQUIRED",
      maySend: false,
      reason:
        candidate.recipientType === "unknown"
          ? "The recipient type is unknown, which is treated as an individual. Unsolicited electronic marketing to individuals, sole traders and ordinary partnerships needs consent or a valid soft opt-in."
          : "Unsolicited electronic marketing to an individual, sole trader or ordinary partnership needs consent or a valid soft opt-in.",
      blockers: [
        "Record consent, establish the soft opt-in, or write to them by post — PECR governs electronic mail, and a letter is a different question.",
      ],
    };
  }

  // A letter to a named individual. Lawful under legitimate interests, which is
  // a test to be applied and recorded rather than asserted, and which the
  // recipient can object to — so the three things that make it lawful are
  // checked here rather than left to whoever is sending.
  if (individual && context.channel === "letter") {
    const missing: string[] = [];
    if (context.mpsScreened !== true) {
      missing.push(
        "Screen the address against the Mailing Preference Service. It is how somebody says in advance that they do not want approaches like this.",
      );
    }
    if (context.privacyNoticeIncluded !== true) {
      missing.push(
        "Include a privacy notice saying where the address came from and how to object. A person written to out of the blue is entitled to know how we found them.",
      );
    }
    if (context.legitimateInterestsRecorded !== true) {
      missing.push(
        "Record the legitimate-interests assessment for this approach. Relying on it without doing it is relying on nothing.",
      );
    }

    if (missing.length > 0) {
      return {
        decision: "COMPLIANCE_APPROVAL_REQUIRED",
        maySend: false,
        reason:
          "A letter to a named individual is lawful under legitimate interests, but only once the things that make it lawful have actually been done.",
        blockers: missing,
      };
    }
  }

  if (message === "credit-promotion" && !context.complianceApproved) {
    return {
      decision: "COMPLIANCE_APPROVAL_REQUIRED",
      maySend: false,
      reason:
        "A communication offering credit needs compliance review before it goes out, whatever the recipient type.",
      blockers: ["Have this message approved."],
    };
  }

  if (message === "borrower-introduction" && !context.dealDisclosureConsent) {
    return {
      decision: "COMPLIANCE_APPROVAL_REQUIRED",
      maySend: false,
      reason:
        "Identifying the property, the price or the borrower to a third party needs the deal owner's consent to disclose. Stage one is anonymous for this reason.",
      blockers: ["Record the deal owner's consent to disclose before introducing the transaction."],
    };
  }

  if (context.alreadyContactedForDeal) {
    return {
      decision: "DRAFT_ONLY",
      maySend: false,
      reason:
        "This recipient has already been contacted about this deal. Repeat approaches are suppressed rather than counted as reach.",
      blockers: ["Wait for a reply, or send a follow-up within the configured frequency cap."],
    };
  }

  return {
    decision: "SEND_ALLOWED",
    maySend: true,
    reason:
      context.channel === "letter"
        ? "Screened, with a privacy notice and a recorded legitimate-interests assessment. The letter may be posted."
        : "A corporate recipient, verified, not opted out, with a published address and an identified sender. A neutral mandate enquiry may be sent.",
    blockers: [],
  };
}

function refuse(decision: OutreachDecision, reason: string): EligibilityDecision {
  return { decision, maySend: false, reason, blockers: [reason] };
}

/* ------------------------------------------------------ message content */

export interface ContentCheck {
  readonly clean: boolean;
  readonly findings: readonly string[];
}

/**
 * A stage-one enquiry must give nothing away.
 *
 * It asks whether an organisation looks at this shape of transaction. It is not
 * a teaser, and it must not carry the address, the seller's situation, the
 * price or a projected return — because at stage one the recipient is a
 * stranger who has not agreed to receive anything about a specific property,
 * and the seller has not consented to being identified to them.
 */
export function checkNeutralEnquiry(text: string): ContentCheck {
  const findings: string[] = [];

  if (/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(text)) {
    findings.push("Contains what looks like a postcode. A mandate enquiry names a region, not an address.");
  }
  if (/\b\d+\s+[A-Z][a-z]+\s+(Road|Street|Lane|Avenue|Drive|Close|Way|Court)\b/.test(text)) {
    findings.push("Contains what looks like a street address.");
  }
  if (/\b(probate|divorce|repossession|arrears|bereave|illness|distress)/i.test(text)) {
    findings.push("Refers to the seller's circumstances. That is the seller's private information and never leaves the platform.");
  }
  if (/\b\d{1,2}(\.\d+)?%\s*(return|yield|profit|roi)\b/i.test(text)) {
    findings.push("States a projected return. A neutral enquiry carries no returns at all.");
  }
  if (/\bunsubscribe|opt[-\s]?out\b/i.test(text) === false) {
    findings.push("No opt-out. Every outreach message must offer a working one.");
  }
  if (/\bwe are\b|\bon behalf of\b|\bfrom\b/i.test(text) === false) {
    findings.push("The sender is not identified. Every message must say who is writing and why.");
  }

  return { clean: findings.length === 0, findings };
}

/* --------------------------------------------------------------- replies */

export type ReplyClass =
  | "INTERESTED"
  | "REQUEST_MORE"
  | "OUT_OF_MANDATE"
  | "DECLINED"
  | "REFERRAL"
  | "REMOVE_ME"
  | "AUTO_REPLY"
  | "LEGAL_COMPLIANCE";

export interface ReplyAssessment {
  readonly classification: ReplyClass;
  /** True where the reply must suppress this recipient immediately. */
  readonly suppress: boolean;
  readonly reason: string;
}

/**
 * Read an inbound reply well enough to act safely on it.
 *
 * Deterministic and deliberately blunt. A model may classify replies more
 * accurately, but the one classification that must never be missed is a request
 * to stop — so removal is matched by rule, first, and acted on regardless of
 * what any model thinks the confidence is. Getting "remove me" wrong is a
 * complaint and a breach; getting "interested" wrong is a follow-up email.
 */
export function classifyReply(text: string): ReplyAssessment {
  const body = text.toLowerCase();

  // Phrased for whichever channel it arrived on. Somebody replying to a letter
  // writes "stop writing" or "no more letters", not "unsubscribe", and a
  // pattern that only knows the email wording misses the postal opt-out
  // entirely.
  if (
    /\b(remove me|unsubscribe|opt out|opt-out|take me off|stop (emailing|contacting|writing|sending)|no more (letters|post|mail)|do not (contact|email|write))\b/.test(
      body,
    )
  ) {
    return {
      classification: "REMOVE_ME",
      suppress: true,
      reason: "A request to stop. Actioned immediately and across every campaign, without waiting for a person.",
    };
  }
  if (/\b(gdpr|data protection|ico|complaint|legal|solicitor|regulat)/.test(body)) {
    return {
      classification: "LEGAL_COMPLIANCE",
      suppress: true,
      reason: "Raises a legal or regulatory point. Suppressed and escalated to a person; nothing further is sent automatically.",
    };
  }
  if (/\b(out of office|automatic reply|auto-reply|away from|annual leave)\b/.test(body)) {
    return { classification: "AUTO_REPLY", suppress: false, reason: "An automatic reply. Not a response." };
  }
  if (/\b(not for us|outside (our|the) mandate|we don't (do|fund|lend)|doesn't fit|not our)\b/.test(body)) {
    return { classification: "OUT_OF_MANDATE", suppress: false, reason: "Outside their mandate. Update the mandate record rather than trying again." };
  }
  if (/\b(speak to|contact|try|refer(red)? you to|colleague)\b/.test(body) && /\b(instead|rather)\b/.test(body)) {
    return { classification: "REFERRAL", suppress: false, reason: "A referral elsewhere." };
  }
  if (/\b(no thanks|not interested|decline|pass on this)\b/.test(body)) {
    return { classification: "DECLINED", suppress: false, reason: "Declined this transaction." };
  }
  if (/\b(more (detail|information)|send (me|us)|what('s| is) the|can you (share|provide))\b/.test(body)) {
    return { classification: "REQUEST_MORE", suppress: false, reason: "Asking for more. Stage two needs approval before anything identifying is sent." };
  }
  if (/\b(interested|keen|we would look|happy to (look|consider)|sounds)\b/.test(body)) {
    return { classification: "INTERESTED", suppress: false, reason: "Expressed interest. Stage two still requires compliance clearance." };
  }

  return {
    classification: "REQUEST_MORE",
    suppress: false,
    reason: "Could not be classified confidently. Treated as needing a person rather than as a positive.",
  };
}

/**
 * What outreach is measured by.
 *
 * Named here because the specification is explicit that it is not email volume,
 * and because the metric a system reports is the metric it optimises. Counting
 * sends rewards sending more; counting terms rewards sending to the right
 * people.
 */
export const OUTREACH_MEASURES = [
  "qualified-interest",
  "introductions-approved",
  "terms-received",
  "funding-completed",
] as const;

/**
 * Customer due diligence on the seller.
 *
 * The Money Laundering Regulations 2017 make an estate agency business
 * responsible for checking *both* parties to a transaction, not the one who
 * happens to be paying it. HMRC is explicit that property is a high-risk
 * sector and expects a documented, risk-based framework rather than a folder
 * of photocopied passports.
 *
 * The Buyer Readiness Passport answers "can this person complete". This
 * answers three different questions, and conflating them is the usual mistake:
 *
 *  1. **Who are they?** Identity, screened against sanctions and PEP lists.
 *  2. **May they sell it?** The person on the telephone is very often not the
 *     registered proprietor — an executor, an attorney, one of two joint
 *     owners, a director of the company that owns it. Every one of those is
 *     legitimate and every one needs different evidence, and a transaction
 *     that reaches exchange before anybody asks is a transaction that fails at
 *     exchange.
 *  3. **Who is actually behind it?** A company or a trust has beneficial
 *     owners, and the whole point of laundering property money through one is
 *     that the name on the title is not the name that matters.
 *
 * Two rules carried across from everything else here. Evidence goes stale, so
 * every date is measured against a date passed in. And absence is never
 * treated as a pass: a seller with nothing recorded is unchecked, which stops
 * the property being marketed rather than being noted as an outstanding item.
 */

export const SELLER_CDD_VERSION = "seller-cdd-1";

/** How long identity and screening stand before they must be redone. */
export const SELLER_CHECK_VALID_MONTHS = 12;

/**
 * Who is selling, which decides what has to be evidenced.
 *
 * Not a cosmetic distinction: an executor needs a grant of probate, an
 * attorney needs a registered power, a company needs its people with
 * significant control. Asking a company for a passport and stopping there is
 * the failure that lets a shell own a house.
 */
export type SellerKind = "individual" | "joint-owners" | "company" | "trust" | "estate" | "attorney";

export interface SellerKindDefinition {
  readonly kind: SellerKind;
  readonly label: string;
  /** What proves this seller may actually sell the property. */
  readonly authorityEvidence: string;
  /** True where people behind the entity must be identified as well. */
  readonly needsBeneficialOwners: boolean;
}

export const SELLER_KINDS: readonly SellerKindDefinition[] = [
  {
    kind: "individual",
    label: "Individual owner",
    authorityEvidence: "Their name on the registered title.",
    needsBeneficialOwners: false,
  },
  {
    kind: "joint-owners",
    label: "Joint owners",
    authorityEvidence: "Every registered proprietor identified, and every one of them agreeing to sell.",
    needsBeneficialOwners: false,
  },
  {
    kind: "company",
    label: "Company",
    authorityEvidence: "Companies House record, the company named on the title, and a director authorised to sell.",
    needsBeneficialOwners: true,
  },
  {
    kind: "trust",
    label: "Trust",
    authorityEvidence: "The trust deed and the trustees named on the title.",
    needsBeneficialOwners: true,
  },
  {
    kind: "estate",
    label: "Executor or administrator",
    authorityEvidence: "Grant of probate or letters of administration. Without it there is nobody who may sell.",
    needsBeneficialOwners: false,
  },
  {
    kind: "attorney",
    label: "Attorney",
    authorityEvidence: "A registered lasting or enduring power of attorney, and confirmation it has not been revoked.",
    needsBeneficialOwners: false,
  },
];

export function sellerKindDefinition(kind: SellerKind): SellerKindDefinition {
  const found = SELLER_KINDS.find((k) => k.kind === kind);
  if (found === undefined) throw new Error(`No definition for seller kind "${kind}".`);
  return found;
}

export interface BeneficialOwner {
  readonly name: string;
  /** Percentage held, as a whole number. Anything over 25 must be identified. */
  readonly holdingPercent: number;
  /** ISO-8601, when this person's identity was verified. */
  readonly verifiedAt?: string;
}

/**
 * Why this seller needs enhanced due diligence.
 *
 * A closed list rather than free text, because "enhanced because it felt odd"
 * is not a documented risk-based decision and HMRC has said so. Free text
 * belongs in the reason, not in the trigger.
 */
export type EnhancedTrigger =
  | "politically-exposed"
  | "high-risk-country"
  | "seller-not-registered-proprietor"
  | "unusual-transaction"
  | "third-party-funds";

export const ENHANCED_TRIGGERS: Readonly<Record<EnhancedTrigger, string>> = {
  "politically-exposed": "The seller, a family member or a close associate is a politically exposed person.",
  "high-risk-country": "The seller or their funds are connected to a high-risk third country.",
  "seller-not-registered-proprietor": "The person selling is not the registered proprietor and the authority for that is unusual.",
  "unusual-transaction": "The transaction has no apparent economic or lawful purpose, or its shape does not match the seller's profile.",
  "third-party-funds": "Somebody other than the seller is paying, or will receive, the proceeds.",
};

export interface SellerDueDiligence {
  readonly kind: SellerKind;
  /** ISO-8601, when identity was verified. */
  readonly identityVerifiedAt?: string;
  readonly identityMethod?: string;
  /** ISO-8601, when screened against sanctions and PEP lists. */
  readonly screenedAt?: string;
  /** ISO-8601, when the authority to sell was evidenced. */
  readonly authorityEvidencedAt?: string;
  /** What was actually seen — the grant, the power, the Companies House entry. */
  readonly authorityEvidence?: string;
  readonly beneficialOwners?: readonly BeneficialOwner[];
  /** ISO-8601, when somebody assessed and recorded the risk on this transaction. */
  readonly riskAssessedAt?: string;
  readonly riskAssessedBy?: string;
  readonly enhancedTriggers?: readonly EnhancedTrigger[];
  /** What was done about them. Required where any trigger is recorded. */
  readonly enhancedMeasures?: string;
}

export interface DueDiligenceCheck {
  readonly label: string;
  readonly held: boolean;
  readonly detail: string;
  /** True where the property may not be marketed without it. */
  readonly blocking: boolean;
}

export interface DueDiligenceReport {
  readonly kind: SellerKindDefinition;
  /** True where the property may be put in front of buyers. */
  readonly mayGoToMarket: boolean;
  readonly checks: readonly DueDiligenceCheck[];
  /** What is stopping it, worst first. Empty when it may go to market. */
  readonly blockers: readonly string[];
  /** True where the recorded triggers require enhanced measures. */
  readonly enhanced: boolean;
  readonly summary: string;
  readonly version: string;
}

function current(iso: string | undefined, now: Date, months: number): boolean {
  if (iso === undefined) return false;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return false;
  // A date in the future is a typo or a fabrication, never a check.
  if (at > now.getTime()) return false;
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return at >= cutoff.getTime();
}

/**
 * The threshold at which a person behind an entity must be identified.
 *
 * Twenty-five per cent is the figure in the Regulations. It is here as a
 * constant rather than inline so that a change in the law is one edit rather
 * than a search.
 */
export const BENEFICIAL_OWNER_THRESHOLD_PERCENT = 25;

export function sellerDueDiligence(
  dd: SellerDueDiligence | undefined,
  now: Date,
): DueDiligenceReport {
  // Nothing recorded is the honest default and the safe one: unchecked, not
  // "no concerns". A seller nobody has looked at is exactly the seller the
  // Regulations exist for.
  const record: SellerDueDiligence = dd ?? { kind: "individual" };
  const kind = sellerKindDefinition(record.kind);

  const identified = current(record.identityVerifiedAt, now, SELLER_CHECK_VALID_MONTHS);
  const screened = current(record.screenedAt, now, SELLER_CHECK_VALID_MONTHS);
  const authorised =
    current(record.authorityEvidencedAt, now, SELLER_CHECK_VALID_MONTHS) &&
    (record.authorityEvidence ?? "").trim() !== "";
  const assessed =
    current(record.riskAssessedAt, now, SELLER_CHECK_VALID_MONTHS) &&
    (record.riskAssessedBy ?? "").trim() !== "";

  const triggers = record.enhancedTriggers ?? [];
  const enhanced = triggers.length > 0;
  const measured = !enhanced || (record.enhancedMeasures ?? "").trim() !== "";

  const owners = record.beneficialOwners ?? [];
  const significant = owners.filter((o) => o.holdingPercent > BENEFICIAL_OWNER_THRESHOLD_PERCENT);
  const ownersIdentified = !kind.needsBeneficialOwners
    ? true
    : significant.length > 0 && significant.every((o) => current(o.verifiedAt, now, SELLER_CHECK_VALID_MONTHS));

  const checks: DueDiligenceCheck[] = [
    {
      label: "Identity verified",
      held: identified,
      blocking: true,
      detail: identified
        ? `${record.identityMethod ?? "Verified"}, within ${SELLER_CHECK_VALID_MONTHS} months.`
        : record.identityVerifiedAt === undefined
          ? "Nothing recorded."
          : "Recorded, but out of date. A check that stale is not a check.",
    },
    {
      label: "Sanctions and PEP screening",
      held: screened,
      blocking: true,
      detail: screened
        ? `Screened within ${SELLER_CHECK_VALID_MONTHS} months.`
        : "Not screened, or the screening has lapsed. Dealing with a designated person is an offence regardless of what anybody knew.",
    },
    {
      label: "Authority to sell",
      held: authorised,
      blocking: true,
      detail: authorised
        ? record.authorityEvidence ?? ""
        : `Not evidenced. ${kind.authorityEvidence}`,
    },
    {
      label: "Beneficial owners identified",
      held: ownersIdentified,
      blocking: kind.needsBeneficialOwners,
      detail: !kind.needsBeneficialOwners
        ? "Not applicable to an individual seller."
        : significant.length === 0
          ? `Nobody holding more than ${BENEFICIAL_OWNER_THRESHOLD_PERCENT}% has been identified. The point of holding property through an entity is that the name on the title is not the name that matters.`
          : ownersIdentified
            ? `${significant.length} identified and verified.`
            : `${significant.filter((o) => !current(o.verifiedAt, now, SELLER_CHECK_VALID_MONTHS)).length} of ${significant.length} not verified, or verified too long ago.`,
    },
    {
      label: "Risk assessed and recorded",
      held: assessed,
      blocking: true,
      detail: assessed
        ? `Assessed by ${record.riskAssessedBy ?? ""}.`
        : "No recorded assessment. HMRC expects a documented, risk-based framework, and an undocumented judgement is indistinguishable from none.",
    },
    {
      label: "Enhanced measures where triggered",
      held: measured,
      blocking: true,
      detail: !enhanced
        ? "No enhanced triggers recorded."
        : measured
          ? `${triggers.length} trigger${triggers.length === 1 ? "" : "s"}, with measures recorded.`
          : `${triggers.map((t) => ENHANCED_TRIGGERS[t]).join(" ")} Nothing has been recorded about what was done.`,
    },
  ];

  const blockers = checks.filter((c) => c.blocking && !c.held).map((c) => `${c.label}: ${c.detail}`);

  return {
    kind,
    mayGoToMarket: blockers.length === 0,
    checks,
    blockers,
    enhanced,
    summary:
      blockers.length === 0
        ? `${kind.label} checked${enhanced ? ", with enhanced measures recorded" : ""}. The property may be put in front of buyers.`
        : `${blockers.length} check${blockers.length === 1 ? "" : "s"} outstanding. The property may not be marketed: a seller nobody has looked at is exactly the seller the Money Laundering Regulations exist for.`,
    version: SELLER_CDD_VERSION,
  };
}

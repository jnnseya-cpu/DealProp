import { ZERO, type Money } from "@shared/money";
import { gbp } from "@shared/format";

/**
 * The Buyer Readiness Passport.
 *
 * A seller in difficulty has a finite amount of patience and exactly one thing
 * to sell. Spending that on a buyer who turns out to have no money is the
 * single most common way a motivated-seller marketplace destroys its own
 * supply — and the seller does not blame the buyer, they blame whoever
 * introduced them.
 *
 * So the passport is a gate rather than a badge. It decides one thing: whether
 * this buyer may be put in front of a seller at all. The grade exists so that
 * a seller can see the difference between the buyers who reach them, and so a
 * buyer can see what is missing rather than being told to try again.
 *
 * Two rules it inherits from the funding readiness score, for the same
 * reasons:
 *
 * **It scores recorded evidence, never the absence of a problem.** A buyer
 * with nothing recorded is grade D, not grade A with no known issues. The most
 * expensive way to find out somebody cannot buy is for the seller to find out
 * first, three weeks in.
 *
 * **Evidence goes stale.** An identity check from four years ago is not a
 * check; a bank balance from last spring is not proof of funds today. Every
 * date below is measured against a date passed in, never against the wall
 * clock, so what a page shows and what a gate decides cannot drift apart.
 */

/**
 * How long each kind of evidence stands for.
 *
 * Identity is twelve months, matching the investor certification and ordinary
 * MLR practice. Funds are three: a statement is a photograph of a balance, and
 * the balance moves. A lender's decision in principle is typically issued for
 * three months and lapses on its own terms, which is why it carries its own
 * expiry rather than being aged here.
 */
export const IDENTITY_VALID_MONTHS = 12;
export const FUNDS_VALID_MONTHS = 3;

export type FundingKind =
  /** Cash on deposit, evidenced. */
  | "cash"
  /** A lender's decision in principle, subject to valuation. */
  | "mortgage-in-principle"
  /** Bridging or development terms issued. */
  | "bridging-terms"
  /** Somebody else's money, with their own evidence behind it. */
  | "backed-by-investor";

export interface ProofOfFunds {
  readonly kind: FundingKind;
  /** ISO-8601 date of the evidence itself, not of the upload. */
  readonly evidencedAt: string;
  /** What the evidence actually shows is available. */
  readonly amount: Money;
  /** Who issued it — the bank, the lender, the investor. Named. */
  readonly issuer: string;
  /**
   * ISO-8601, where the evidence expires on its own terms.
   *
   * A decision in principle says when it lapses. Honouring that is not the
   * same as ageing it ourselves, and the earlier of the two wins.
   */
  readonly expiresAt?: string;
}

/**
 * What has actually been checked about a buyer.
 *
 * Every field optional and absence meaningful — nothing here defaults to a
 * value that would earn a grade.
 */
export interface PassportEvidence {
  /** ISO-8601, when identity was verified. */
  readonly identityVerifiedAt?: string;
  /** How, in a sentence somebody could audit. */
  readonly identityMethod?: string;
  /** ISO-8601, when sanctions and PEP screening was run. */
  readonly screenedAt?: string;
  readonly proofOfFunds?: ProofOfFunds;
  /** ISO-8601, when the source of those funds was evidenced. */
  readonly sourceOfFundsAt?: string;
  /** Purchases this buyer has actually completed through the platform. */
  readonly completedPurchases?: number;
  /** The conveyancer instructed and ready, where one is. */
  readonly solicitor?: string;
}

/**
 * A–D.
 *
 * Deliberately four rather than a percentage. A seller deciding who to speak to
 * needs a distinction they can act on, and "78 out of 100" is not one.
 */
export type PassportGrade = "A" | "B" | "C" | "D";

export interface GradeDefinition {
  readonly grade: PassportGrade;
  readonly label: string;
  readonly meaning: string;
  /** True where a buyer at this grade may be put in front of a seller. */
  readonly mayApproachSeller: boolean;
}

export const GRADES: readonly GradeDefinition[] = [
  {
    grade: "A",
    label: "Proceedable",
    meaning:
      "Identity verified, screened, and funds evidenced in full for the price — with a completed purchase or a solicitor already instructed.",
    mayApproachSeller: true,
  },
  {
    grade: "B",
    label: "Funded, subject to",
    meaning:
      "Identity verified and screened, with funding evidenced but conditional — short of the price, subject to valuation, or resting on somebody else's money.",
    mayApproachSeller: true,
  },
  {
    grade: "C",
    label: "Identified only",
    meaning:
      "We know who they are. Nothing has been evidenced about their ability to pay, so they do not reach a seller.",
    mayApproachSeller: false,
  },
  {
    grade: "D",
    label: "Unverified",
    meaning: "Nothing current is recorded. This is where every buyer starts.",
    mayApproachSeller: false,
  },
];

export function gradeDefinition(grade: PassportGrade): GradeDefinition {
  const found = GRADES.find((g) => g.grade === grade);
  if (found === undefined) throw new Error(`No definition for grade "${grade}".`);
  return found;
}

export interface PassportCheck {
  readonly label: string;
  readonly held: boolean;
  /** Why it is not held, or what it proves where it is. */
  readonly detail: string;
}

export interface Passport {
  readonly grade: PassportGrade;
  readonly definition: GradeDefinition;
  /** True where this buyer may be put in front of a seller today. */
  readonly mayApproachSeller: boolean;
  readonly checks: readonly PassportCheck[];
  /** What would move them up a grade, in the order it should be dealt with. */
  readonly missing: readonly string[];
  /** Evidenced funds, or zero where nothing current is recorded. */
  readonly evidencedFunds: Money;
  readonly caveat: string;
}

function monthsBefore(now: Date, months: number): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}

/** True where an ISO date is readable and no older than the window. */
function current(iso: string | undefined, now: Date, months: number): boolean {
  if (iso === undefined) return false;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return false;
  // A date in the future is not evidence, it is a typo or a fabrication.
  if (at > now.getTime()) return false;
  return at >= monthsBefore(now, months).getTime();
}

/** Whether the proof of funds still stands today. */
export function fundsAreCurrent(proof: ProofOfFunds | undefined, now: Date): boolean {
  if (proof === undefined) return false;
  if (!current(proof.evidencedAt, now, FUNDS_VALID_MONTHS)) return false;
  if (proof.expiresAt === undefined) return true;
  const expiry = Date.parse(proof.expiresAt);
  // Unreadable expiry is treated as expired. The alternative is that a
  // malformed date buys an indefinite extension.
  if (Number.isNaN(expiry)) return false;
  return expiry >= now.getTime();
}

/**
 * The buyer's passport, against a price and a date.
 *
 * The price matters because "funded" is not an absolute: £180,000 evidenced is
 * grade A against a £172,000 terrace and grade B against a £400,000 one. A
 * marketplace that grades buyers without reference to what they are trying to
 * buy is grading them against nothing.
 */
export function buyerPassport(
  evidence: PassportEvidence,
  price: Money,
  now: Date,
): Passport {
  const identified = current(evidence.identityVerifiedAt, now, IDENTITY_VALID_MONTHS);
  const screened = current(evidence.screenedAt, now, IDENTITY_VALID_MONTHS);
  const proof = evidence.proofOfFunds;
  const fundsCurrent = fundsAreCurrent(proof, now);
  const sourceEvidenced = current(evidence.sourceOfFundsAt, now, FUNDS_VALID_MONTHS);
  const evidencedFunds = fundsCurrent && proof !== undefined ? proof.amount : ZERO;
  const coversPrice = evidencedFunds >= price && price > ZERO;
  const unconditional = fundsCurrent && proof?.kind === "cash";
  const track = (evidence.completedPurchases ?? 0) > 0 || (evidence.solicitor ?? "") !== "";

  const checks: PassportCheck[] = [
    {
      label: "Identity verified",
      held: identified,
      detail: identified
        ? `${evidence.identityMethod ?? "Verified"}, within ${IDENTITY_VALID_MONTHS} months.`
        : evidence.identityVerifiedAt === undefined
          ? "Nothing recorded."
          : `Recorded, but older than ${IDENTITY_VALID_MONTHS} months. A check that stale is not a check.`,
    },
    {
      label: "Sanctions and PEP screening",
      held: screened,
      detail: screened
        ? `Screened within ${IDENTITY_VALID_MONTHS} months.`
        : "Not screened, or the screening has lapsed.",
    },
    {
      label: "Funds evidenced",
      held: fundsCurrent,
      detail: fundsCurrent && proof !== undefined
        ? `${gbp(proof.amount)} — ${proof.kind.replace(/-/g, " ")}, from ${proof.issuer}.`
        : proof === undefined
          ? "Nothing recorded."
          : `Recorded, but out of date. Funds evidence stands for ${FUNDS_VALID_MONTHS} months, or until it expires on its own terms.`,
    },
    {
      label: "Funds cover the price",
      held: coversPrice,
      detail: coversPrice
        ? `${gbp(evidencedFunds)} evidenced against ${gbp(price)}.`
        : `${gbp(evidencedFunds)} evidenced against ${gbp(price)}. A shortfall is not a defect, but it is a condition the seller is entitled to know about.`,
    },
    {
      label: "Source of funds",
      held: sourceEvidenced,
      detail: sourceEvidenced
        ? "Evidenced."
        : "Not evidenced. Required before completion whatever the grade.",
    },
    {
      label: "Track record or solicitor instructed",
      held: track,
      detail: track
        ? evidence.solicitor !== undefined && evidence.solicitor !== ""
          ? `${evidence.solicitor} instructed.`
          : `${String(evidence.completedPurchases ?? 0)} completed through the platform.`
        : "No completed purchase and no conveyancer instructed.",
    },
  ];

  const grade: PassportGrade = !identified || !screened
    ? "D"
    : !fundsCurrent
      ? "C"
      : coversPrice && unconditional && track
        ? "A"
        : "B";

  const definition = gradeDefinition(grade);

  return {
    grade,
    definition,
    mayApproachSeller: definition.mayApproachSeller,
    checks,
    missing: checks.filter((c) => !c.held).map((c) => `${c.label}: ${c.detail}`),
    evidencedFunds,
    caveat:
      "A passport is evidence of what has been checked, not a guarantee that a purchase will complete. It is not a credit reference and must never be presented as one.",
  };
}

/**
 * May this buyer be put in front of this seller?
 *
 * The one question the passport exists to answer, given its own function so
 * that a call site cannot accidentally read the grade and decide for itself.
 * Grade C is the interesting refusal: we know exactly who they are, and that
 * is still not a reason to spend a seller's patience on them.
 */
export interface ApproachDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export function mayApproachSeller(passport: Passport): ApproachDecision {
  if (passport.mayApproachSeller) {
    return {
      allowed: true,
      reason: `Grade ${passport.grade} — ${passport.definition.label.toLowerCase()}. ${passport.definition.meaning}`,
    };
  }
  return {
    allowed: false,
    reason: `Grade ${passport.grade}. ${passport.definition.meaning} ${
      passport.missing[0] ?? "Record the evidence first."
    }`,
  };
}

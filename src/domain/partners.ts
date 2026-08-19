import type { Money } from "@/lib/money";
import { fromMajor } from "@/lib/money";
import type { PropertyFacts, PropertyIssue, SellerProfile } from "@/domain/types";

/**
 * Trade partner referrals.
 *
 * Every deal on this platform carries a refurbishment line, and somebody has to
 * do the work. Rather than leave that as an exercise for the reader, a property
 * whose figures assume works names who can carry them out.
 *
 * Two rules this module enforces, and they are the reason it is a domain module
 * rather than a link in a page:
 *
 *  1. **A referral always states why it fired.** The same standard the Deal
 *     Score and the match report are held to — no bare recommendation.
 *  2. **A referral always carries its disclosure.** Introducing a consumer to a
 *     business connected to the platform, or to any business at all, is
 *     disclosable under the Estate Agents Act 1979 (ss.18 and 21) and the
 *     Consumer Protection from Unfair Trading Regulations. The disclosure is
 *     derived from the partner record, so a referral cannot be rendered without
 *     it, and changing a commercial arrangement changes the wording everywhere
 *     in one edit.
 */

/**
 * The platform's relationship with the partner.
 *
 * This is a statement of fact made to a consumer, so both values are wrong to
 * guess at: claiming independence for a connected business understates an
 * interest, and claiming a connection that does not exist misdescribes a third
 * party. Confirm before launch.
 */
export type PartnerRelationship = "connected-party" | "independent";

/**
 * Whether money changes hands on an introduction.
 *
 * No fee is charged today. When one is, it becomes `referral-fee`, the
 * disclosure below changes with it, and it is charged through the
 * `professional-marketplace` revenue stream — which is permission-gated for
 * exactly this reason.
 */
export type FeeArrangement = "none" | "referral-fee";

export interface TradePartner {
  readonly key: string;
  readonly name: string;
  readonly url: string;
  /** What this partner is for, in one line, in the user's terms. */
  readonly remit: string;
  readonly relationship: PartnerRelationship;
  readonly feeArrangement: FeeArrangement;
}

/**
 * The partner directory.
 *
 * Neither website could be read from the build environment, so nothing here
 * describes services, coverage or accreditations that have not been stated
 * directly. An unverified claim about a contractor's capability is worse than
 * no claim: the seller acts on it.
 */
export const TRADE_PARTNERS: readonly TradePartner[] = [
  {
    key: "jnseya",
    name: "JNseya Construction",
    url: "https://jnseya.co.uk",
    remit: "Renovation and refurbishment",
    relationship: "connected-party",
    feeArrangement: "none",
  },
  {
    key: "evandeli",
    name: "Evandeli",
    url: "https://www.evandeli.com",
    remit: "Tradespeople for individual jobs and specialist work",
    relationship: "independent",
    feeArrangement: "none",
  },
];

function partner(key: string): TradePartner {
  const found = TRADE_PARTNERS.find((p) => p.key === key);
  if (found === undefined) throw new Error(`unknown trade partner: ${key}`);
  return found;
}

/**
 * Where a works budget stops being a job and becomes a project.
 *
 * Below this a property needs a trade or two; above it, it needs somebody
 * running the programme. The figure is the point at which a refurbishment
 * typically involves more than two trades in sequence.
 */
export const MAIN_CONTRACTOR_THRESHOLD: Money = fromMajor(15_000);

/** Defects that need a named specialist rather than a general builder. */
const SPECIALIST_ISSUES: Partial<Record<PropertyIssue, string>> = {
  structural: "structural movement",
  damp: "damp",
  subsidence: "subsidence",
  "japanese-knotweed": "Japanese knotweed",
  cladding: "cladding",
  "no-building-regs": "work carried out without building regulations approval",
  "non-standard-construction": "non-standard construction",
};

export interface TradeReferral {
  readonly partner: TradePartner;
  /** Why this property triggered this referral. Never empty. */
  readonly reasons: readonly string[];
  /** Must be displayed wherever the referral is. Never empty. */
  readonly disclosure: string;
}

export interface TradeReferralReport {
  readonly referrals: readonly TradeReferral[];
  /** True where the figures assume work is done to the property. */
  readonly worksImplied: boolean;
  /** The works budget the referral is against. */
  readonly worksBudget: Money;
}

/**
 * The disclosure shown with a referral.
 *
 * Built from the partner record rather than written per page, so no surface can
 * show the introduction without the interest behind it.
 */
export function disclosureFor(p: TradePartner): string {
  const interest =
    p.relationship === "connected-party"
      ? `${p.name} is connected to Lode by common ownership, so we have an interest in this introduction.`
      : `${p.name} is an independent business and we have no ownership interest in it.`;

  const fee =
    p.feeArrangement === "none"
      ? "No fee is paid or received for the introduction."
      : "We receive a fee if you engage them, which does not change what you pay.";

  return `${interest} ${fee} You are free to use any contractor you choose, and we would encourage you to obtain more than one estimate.`;
}

function referral(p: TradePartner, reasons: readonly string[]): TradeReferral {
  return { partner: p, reasons, disclosure: disclosureFor(p) };
}

/**
 * Who should do the work on this property, and why.
 *
 * A large budget implies a main contractor running a programme; a small one
 * implies individual trades. A named defect implies a specialist regardless of
 * budget, which is why both referrals can fire on the same property.
 */
export function referTradePartners(
  property: PropertyFacts,
  seller?: SellerProfile,
): TradeReferralReport {
  const budget = property.refurbishmentEstimate;
  const needsWorkSituation = seller?.situation === "needs-major-works";
  const worksImplied = budget > 0 || needsWorkSituation;

  const specialists = property.knownIssues
    .map((issue) => SPECIALIST_ISSUES[issue])
    .filter((label): label is string => label !== undefined);

  const referrals: TradeReferral[] = [];

  if (worksImplied && budget >= MAIN_CONTRACTOR_THRESHOLD) {
    const reasons = [
      `The figures assume ${gbpish(budget)} of works, which is a programme rather than a single job.`,
    ];
    if (needsWorkSituation) {
      reasons.push("You told us the property needs substantial work.");
    }
    referrals.push(referral(partner("jnseya"), reasons));
  }

  const smallJob = worksImplied && budget < MAIN_CONTRACTOR_THRESHOLD;
  if (smallJob || specialists.length > 0) {
    const reasons: string[] = [];
    if (smallJob) {
      reasons.push("The works assumed here are small enough to be handled by individual trades.");
    }
    if (specialists.length > 0) {
      const subject = sentenceCase(listWords(specialists));
      const verb = specialists.length === 1 ? "needs a specialist report" : "need specialist reports";
      reasons.push(`${subject} ${verb} before any estimate is reliable.`);
    }
    referrals.push(referral(partner("evandeli"), reasons));
  }

  return { referrals, worksImplied, worksBudget: budget };
}

/** "a", "a and b", "a, b and c" — an Oxford-comma-free English list. */
function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Money as words, for a sentence rather than a table.
 *
 * lib/format's `gbp` is the right formatter everywhere a figure is compared
 * against another figure. Inside prose a rounded thousand reads better and does
 * not imply a precision the estimate does not have.
 */
function gbpish(amount: Money): string {
  const thousands = Math.round(amount / 100 / 1_000);
  return thousands >= 1 ? `around £${thousands.toLocaleString("en-GB")}k` : "under £1k";
}

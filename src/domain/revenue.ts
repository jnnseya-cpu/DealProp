import { add, applyBps, fromMajor, pct, ZERO, type Bps, type Money } from "@/lib/money";
import type { DealAppraisal } from "@/domain/types";

/**
 * Monetisation model.
 *
 * The strategic position encoded here: the motivated seller is the supply
 * engine and is not charged. Revenue comes from the professionals, capital and
 * completed transactions that gather around the opportunity.
 *
 * REGULATORY DEPENDENCY: several of these streams are only lawful with the
 * right permissions. Success fees on introductions engage estate agency and
 * AML supervision; funding introduction fees can be credit broking. The
 * `requiresPermission` field is not documentation — the revenue calculator
 * excludes any stream whose permission has not been granted, so the platform
 * cannot accidentally model income it is not allowed to earn.
 */

export type RevenueStream =
  | "buyer-subscription"
  | "deal-success-fee"
  | "funding-introduction"
  | "deal-packaging"
  | "ai-credits"
  | "lender-membership"
  | "professional-marketplace"
  | "enterprise-api";

export interface StreamDefinition {
  readonly key: RevenueStream;
  readonly label: string;
  readonly payer: string;
  readonly recurring: boolean;
  /** Permission that must be held before this stream may be charged. */
  readonly requiresPermission?: string;
  readonly note: string;
}

export const STREAMS: readonly StreamDefinition[] = [
  {
    key: "buyer-subscription",
    label: "Buyer membership",
    payer: "Investors and dealmakers",
    recurring: true,
    note: "Recurring access to opportunities, analysis and structuring. The cleanest revenue on the platform: no permission dependency, no transaction linkage.",
  },
  {
    key: "deal-success-fee",
    label: "Deal success fee",
    payer: "Buyer",
    recurring: false,
    requiresPermission: "Estate agency AML registration and redress scheme membership",
    note: "Charged on completion. Introducing a seller to a buyer for a fee is estate agency work in the UK and must be supervised and disclosed to the seller.",
  },
  {
    key: "funding-introduction",
    label: "Funding introduction",
    payer: "Lender or broker",
    recurring: false,
    requiresPermission: "FCA authorisation or appointed representative status for credit broking",
    note: "Introducing borrowers to lenders for a fee is a regulated activity. Unauthorised introduction fees are both unlawful and unrecoverable.",
  },
  {
    key: "deal-packaging",
    label: "Deal packaging",
    payer: "Buyer",
    recurring: false,
    requiresPermission: "Estate agency AML registration",
    note: "Preparing the deal pack. Charged whether or not the deal completes, so it must be described accurately at the point of sale.",
  },
  {
    key: "ai-credits",
    label: "AI analysis credits",
    payer: "Buyers and professionals",
    recurring: false,
    note: "Usage-based. Earns revenue on deals that never complete, which smooths income against transaction volatility.",
  },
  {
    key: "lender-membership",
    label: "Capital provider membership",
    payer: "Lenders and funds",
    recurring: true,
    note: "Paying for qualified deal flow matched to a mandate, not for a directory listing.",
  },
  {
    key: "professional-marketplace",
    label: "Professional marketplace",
    payer: "Solicitors, surveyors, accountants",
    recurring: true,
    requiresPermission: "Referral arrangements must comply with professional conduct rules",
    note: "Subscription to the transaction workflow. Referral fees paid to or by regulated professionals carry disclosure obligations.",
  },
  {
    key: "enterprise-api",
    label: "Enterprise and API licensing",
    payer: "Property firms, funds, lenders",
    recurring: true,
    note: "White-labelled infrastructure. The route into new countries without building a consumer brand from zero.",
  },
];

export interface Tier {
  readonly name: string;
  readonly monthly: Money;
  readonly summary: string;
  readonly features: readonly string[];
}

export const BUYER_TIERS: readonly Tier[] = [
  {
    name: "Explorer",
    monthly: ZERO,
    summary: "See that opportunities exist.",
    features: ["Limited opportunity browsing", "One Buy Box", "Deal Score headline only"],
  },
  {
    name: "Investor",
    monthly: fromMajor(49),
    summary: "Deal alerts and full search.",
    features: ["Full opportunity search", "Three Buy Boxes", "Deal alerts", "Full Deal Score breakdown"],
  },
  {
    name: "DealMaker",
    monthly: fromMajor(149),
    summary: "Analysis and structuring.",
    features: ["Strategy Router", "Red Team stress testing", "Capital Stack builder", "GoldMine access", "Monthly AI credits"],
  },
  {
    name: "Professional",
    monthly: fromMajor(399),
    summary: "Funding matching and Deal Rooms.",
    features: ["Funding Box matching", "Unlimited Buy Boxes", "Deal Rooms", "Investment memoranda", "Priority support"],
  },
  {
    name: "Business",
    monthly: fromMajor(999),
    summary: "Teams, automation and API.",
    features: ["Team accounts", "Portfolio sourcing", "API access", "Custom underwriting rules"],
  },
];

export const FUNDER_TIERS: readonly Tier[] = [
  { name: "Private lender", monthly: fromMajor(299), summary: "Matched deal flow.", features: ["Two Funding Boxes", "Matched deals", "Deal Room access"] },
  { name: "Professional", monthly: fromMajor(999), summary: "Underwriting workflow.", features: ["Unlimited Funding Boxes", "AI underwriting summaries", "Portfolio view"] },
  { name: "Institutional", monthly: fromMajor(2_500), summary: "Origination pipeline.", features: ["API access", "Custom mandate logic", "Dedicated origination"] },
];

export interface RevenueAssumptions {
  readonly successFeeBps: Bps;
  readonly fundingIntroBps: Bps;
  readonly packagingFee: Money;
  readonly aiCreditsPerDeal: Money;
  readonly subscriptionAllocation: Money;
  readonly professionalServices: Money;
  /** Permissions actually held. Streams requiring anything absent are excluded. */
  readonly permissionsHeld: readonly string[];
}

export const DEFAULT_ASSUMPTIONS: RevenueAssumptions = {
  successFeeBps: pct(0.75),
  fundingIntroBps: pct(0.5),
  packagingFee: fromMajor(199),
  aiCreditsPerDeal: fromMajor(50),
  subscriptionAllocation: fromMajor(149),
  professionalServices: fromMajor(300),
  permissionsHeld: [],
};

export interface RevenueLine {
  readonly stream: RevenueStream;
  readonly label: string;
  readonly amount: Money;
  readonly included: boolean;
  readonly excludedBecause?: string;
}

export interface DealRevenue {
  readonly lines: readonly RevenueLine[];
  readonly total: Money;
  readonly forgone: Money;
  readonly note: string;
}

/**
 * Revenue the platform earns from one completed transaction.
 *
 * Streams whose permission is not held are reported at zero with the reason,
 * so the gap between "what this deal could earn" and "what we may lawfully
 * charge today" is visible rather than assumed away.
 */
export function dealRevenue(
  appraisal: DealAppraisal,
  assumptions: RevenueAssumptions = DEFAULT_ASSUMPTIONS,
): DealRevenue {
  const held = new Set(assumptions.permissionsHeld);
  const lines: RevenueLine[] = [];
  let forgone = ZERO;

  const consider = (
    stream: RevenueStream,
    amount: Money,
  ): void => {
    const def = STREAMS.find((s) => s.key === stream);
    if (def === undefined) return;
    const permission = def.requiresPermission;
    const allowed = permission === undefined || held.has(permission);
    if (allowed) {
      lines.push({ stream, label: def.label, amount, included: true });
    } else {
      lines.push({
        stream,
        label: def.label,
        amount: ZERO,
        included: false,
        excludedBecause: `Requires: ${permission}`,
      });
      forgone = add(forgone, amount);
    }
  };

  consider("buyer-subscription", assumptions.subscriptionAllocation);
  consider("ai-credits", assumptions.aiCreditsPerDeal);
  consider("deal-packaging", assumptions.packagingFee);
  consider("deal-success-fee", applyBps(appraisal.inputs.purchasePrice, assumptions.successFeeBps));
  consider("funding-introduction", applyBps(appraisal.funding.seniorDebt, assumptions.fundingIntroBps));
  consider("professional-marketplace", assumptions.professionalServices);

  const total = add(...lines.filter((l) => l.included).map((l) => l.amount));

  return {
    lines,
    total,
    forgone,
    note:
      forgone > 0
        ? "Some streams are excluded because the required permissions are not recorded as held. Obtain them before modelling this revenue."
        : "All modelled streams are permitted under the recorded permissions.",
  };
}

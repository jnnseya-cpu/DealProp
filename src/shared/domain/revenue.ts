import { add, applyBps, fromMajor, pct, ZERO, type Bps, type Money } from "@shared/money";
import type { DealAppraisal } from "@shared/domain/types";
import {
  plan,
  successFee,
  successFeeBand,
  type PlanAudience,
  type SellerService,
} from "@shared/domain/pricing";
import { PLANS } from "@shared/domain/pricing";
import { permissionDefinition, type PermissionKey } from "@shared/domain/permissions";

/**
 * Monetisation model.
 *
 * The strategic position encoded here: nobody pays to be introduced to a
 * possibility. The seller pays a percentage of a completed sale and nothing at
 * any other point; the buyer pays for access, analysis and the transaction;
 * the capital and the professionals pay for qualified flow. Every charge on
 * the list attaches to something that has actually happened.
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
  | "opportunity-reveal"
  | "seller-success-fee"
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
  /**
   * Permissions that must ALL be held before this stream may be charged.
   *
   * Keys into the one catalogue rather than a sentence, because a sentence
   * cannot be compared against configuration without the two being written
   * identically twice — which is how this stream ended up permanently
   * excluded by a default nobody could reach.
   */
  readonly requiresPermissions?: readonly PermissionKey[];
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
    key: "opportunity-reveal",
    label: "Opportunity reveal",
    payer: "Buyer",
    recurring: false,
    requiresPermissions: ["estate-agency-aml", "redress-scheme"],
    note: "Opening one verified opportunity: the pack, the introduction and the transaction intelligence. Charging a buyer to be introduced to a seller is estate agency work whichever way the money flows, and it may never be charged on stock nobody has confirmed is for sale.",
  },
  {
    key: "seller-success-fee",
    label: "Seller success fee",
    payer: "Seller",
    recurring: false,
    requiresPermissions: ["estate-agency-aml", "redress-scheme"],
    note: "A percentage of the price achieved, due on completion and at no other point. Selling a property for a fee is estate agency work: it needs AML supervision, redress-scheme membership, and the fee disclosed to the seller before they are bound.",
  },
  {
    key: "deal-success-fee",
    label: "Deal success fee",
    payer: "Buyer",
    recurring: false,
    requiresPermissions: ["estate-agency-aml", "redress-scheme"],
    note: "Charged on completion. Introducing a seller to a buyer for a fee is estate agency work in the UK and must be supervised and disclosed to the seller.",
  },
  {
    key: "funding-introduction",
    label: "Funding introduction",
    payer: "Lender or broker",
    recurring: false,
    requiresPermissions: ["credit-broking"],
    note: "Introducing borrowers to lenders for a fee is a regulated activity. Unauthorised introduction fees are both unlawful and unrecoverable.",
  },
  {
    key: "deal-packaging",
    label: "Deal packaging",
    payer: "Buyer",
    recurring: false,
    requiresPermissions: ["estate-agency-aml"],
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
    requiresPermissions: ["professional-referrals"],
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

/**
 * The published tiers, derived from the chargeable catalogue.
 *
 * Derived rather than restated, because these are rendered on the landing page
 * and the same numbers are what a customer is charged. Two lists eventually
 * disagree, and the one the customer saw is never the one that loses the
 * argument — a price advertised at £49 and charged at £59 is a refund and a
 * complaint; advertised at £59 and charged at £49 is a permanent discount
 * nobody authorised. `pricing.ts` owns the figure; this presents it.
 */
function tiersFor(audience: PlanAudience): readonly Tier[] {
  return PLANS.filter((p) => p.audience === audience).map((p) => ({
    name: p.name,
    monthly: p.price,
    summary: p.summary,
    features: p.features,
  }));
}

export const BUYER_TIERS: readonly Tier[] = tiersFor("buyer");

export const FUNDER_TIERS: readonly Tier[] = tiersFor("funder");

export interface RevenueAssumptions {
  /** Which seller service the modelled sale is on. Decides the banded fee. */
  readonly sellerService: SellerService;
  readonly successFeeBps: Bps;
  readonly fundingIntroBps: Bps;
  readonly packagingFee: Money;
  readonly aiCreditsPerDeal: Money;
  readonly subscriptionAllocation: Money;
  readonly professionalServices: Money;
  /** Permissions actually held. Streams requiring anything absent are excluded. */
  readonly permissionsHeld: readonly PermissionKey[];
}

/**
 * The mid-tier buyer subscription, allocated to one deal.
 *
 * Derived rather than restated. It was written here as a literal and drifted
 * from the catalogue the first time a tier was repriced, which is exactly the
 * failure `pricing.ts` exists to prevent.
 */
const MID_TIER = plan("buyer-dealmaker");
if (MID_TIER === undefined) throw new Error("The mid-tier buyer plan is missing from the catalogue.");

export const DEFAULT_ASSUMPTIONS: RevenueAssumptions = {
  sellerService: "standard",
  // The buyer-side rate is a modelling assumption; the seller-side one is a
  // published price and therefore comes from the catalogue.
  successFeeBps: pct(0.75),
  fundingIntroBps: pct(0.5),
  packagingFee: fromMajor(199),
  aiCreditsPerDeal: fromMajor(50),
  subscriptionAllocation: MID_TIER.price,
  professionalServices: fromMajor(300),
  permissionsHeld: [],
};

/** The published seller rate, so a page never has to restate it. */
export const SELLER_SUCCESS_FEE_BPS: Bps = successFeeBand("standard").rateBps;

export interface RevenueLine {
  readonly stream: RevenueStream;
  readonly label: string;
  readonly amount: Money;
  readonly included: boolean;
  readonly excludedBecause?: string;
  /** Which permissions are missing, so a page can say what to obtain. */
  readonly missing?: readonly PermissionKey[];
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
    const required = def.requiresPermissions ?? [];
    const missing = required.filter((key) => !held.has(key));
    if (missing.length === 0) {
      lines.push({ stream, label: def.label, amount, included: true });
    } else {
      lines.push({
        stream,
        label: def.label,
        amount: ZERO,
        included: false,
        excludedBecause: `Requires ${missing.map((k) => permissionDefinition(k).label.toLowerCase()).join(" and ")}.`,
        missing,
      });
      forgone = add(forgone, amount);
    }
  };

  consider("buyer-subscription", assumptions.subscriptionAllocation);
  consider("ai-credits", assumptions.aiCreditsPerDeal);
  consider("deal-packaging", assumptions.packagingFee);
  consider(
    "seller-success-fee",
    successFee(appraisal.inputs.purchasePrice, assumptions.sellerService),
  );
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

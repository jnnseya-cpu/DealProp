import { ZERO, type Money } from "@shared/money";
import { permissionDefinition, type PermissionKey } from "@shared/domain/permissions";
import { revealPrice, type OpportunityClass } from "@shared/domain/pricing";
import type { PropertyFacts, PropertyType, Tenure } from "@shared/domain/types";
import { mayApproachSeller, type Passport } from "@shared/domain/passport";
import {
  categoryDefect,
  categoryDefinition,
  saleIsConfirmed,
  type InventoryCategory,
  type InventoryItem,
} from "@shared/domain/inventory";

/**
 * Charging a buyer to open an opportunity.
 *
 * What the fee buys has to be stated precisely, because the wrong answer is
 * both the obvious one and prohibited: it does not buy an address, and it does
 * not buy a telephone number. Charging to unlock a contact detail that is
 * already on a portal is the thing that makes a buyer feel cheated the first
 * time they check, and one check is all it takes.
 *
 * It buys a verified opportunity pack, an introduction to somebody who has
 * agreed to be introduced, and the transaction intelligence around it. Which
 * means it cannot be charged on stock where nobody has agreed to anything, and
 * that is enforced here rather than trusted to a page.
 *
 * Everything below is one question — *may we take this money, and if we do,
 * what have we promised* — and the answer is deliberately conservative in both
 * halves. A reveal refused costs a sale. A reveal charged on an opportunity
 * that turns out not to exist costs the account, the refund, the dispute fee,
 * and whoever they tell.
 */

export const REVEAL_VERSION = "reveal-1";

/**
 * Charging a buyer to be introduced to a seller is estate agency work under
 * the Estate Agents Act 1979, whichever way round the money flows.
 */
export const REVEAL_PERMISSIONS: readonly PermissionKey[] = ["estate-agency-aml", "redress-scheme"];

/**
 * How long a buyer has to claim, and how long the seller has to answer.
 *
 * Both are stated at the point of sale rather than discovered afterwards. A
 * guarantee a customer finds out about only when they complain is not a
 * guarantee, it is a concession, and it does not sell anything.
 */
export const SELLER_RESPONSE_DAYS = 7;
export const REFUND_WINDOW_DAYS = 14;

/**
 * What the buyer is promised, in the words they are shown.
 *
 * A single source, because a guarantee published in marketing and applied by
 * support eventually differ, and the difference is always in our favour, which
 * is how it becomes a complaint to a redress scheme.
 */
export const REVEAL_GUARANTEE: readonly string[] = [
  `If the seller does not respond within ${SELLER_RESPONSE_DAYS} days of the introduction, the fee is refunded in full.`,
  "If the property is already sold or under offer at the moment you open it, the fee is refunded in full.",
  "If the owner tells us it is not for sale, the fee is refunded in full.",
  "If the pack materially misdescribes the property, the fee is refunded in full.",
  `Claims are made through the platform within ${REFUND_WINDOW_DAYS} days. The refund is automatic; nobody has to be persuaded.`,
];

export interface RevealBlocker {
  readonly reason: string;
  readonly remedy: string;
}

export interface RevealQuote {
  readonly opportunity: OpportunityClass;
  readonly price: Money;
  /** True where the money may be taken right now. */
  readonly chargeable: boolean;
  readonly blockers: readonly RevealBlocker[];
  /** The category sentence the buyer must be shown, verbatim. */
  readonly disclosure: string;
  readonly guarantee: readonly string[];
  readonly version: string;
}

export interface RevealContext {
  readonly opportunity: OpportunityClass;
  readonly item: InventoryItem;
  readonly permissionsHeld: readonly PermissionKey[];
  /** True where the listing is already sold, under offer or withdrawn. */
  readonly closed?: boolean;
  /** True where this buyer has already paid to open this opportunity. */
  readonly alreadyOpened?: boolean;
  /**
   * True where the property is currently advertised somewhere public.
   *
   * A property on a portal has its agent's telephone number beside it. The fee
   * would be a toll on information the buyer could have had for nothing, and
   * they find that out with one search — which is why this is a refusal rather
   * than a smaller price.
   */
  readonly openlyAdvertised?: boolean;
  /**
   * The buyer's passport.
   *
   * Absent means nobody has been graded, which is treated as grade D. A reveal
   * ends in an introduction, so the gate on approaching a seller is the gate on
   * paying to open the opportunity — checking readiness after the money has
   * changed hands is checking it too late for both sides.
   */
  readonly passport?: Passport;
}

export function quoteReveal(context: RevealContext): RevealQuote {
  const definition = categoryDefinition(context.item.category);
  const blockers: RevealBlocker[] = [];

  for (const key of REVEAL_PERMISSIONS) {
    if (context.permissionsHeld.includes(key)) continue;
    const permission = permissionDefinition(key);
    blockers.push({
      reason: `${permission.label} is not recorded as held.`,
      remedy: `Obtain it from ${permission.regulator} and record the ${permission.evidenceLabel.toLowerCase()}. Charging a buyer to be introduced to a seller is estate agency work whichever way the money flows.`,
    });
  }

  const defect = categoryDefect(context.item);
  if (defect !== undefined) {
    blockers.push({
      reason: defect,
      remedy: "Correct the category before it is offered to anybody. The category is shown to the buyer and decides the price.",
    });
  }

  if (!saleIsConfirmed(context.item)) {
    blockers.push({
      reason: "Nobody connected to the property has confirmed it is for sale.",
      remedy:
        "Contact the owner and record what they said. Until then the opportunity may be shown, with its category, but not sold — a buyer who pays and finds an owner who never agreed to sell has been sold nothing.",
    });
  }

  const approach =
    context.passport === undefined
      ? {
          allowed: false,
          reason:
            "Nothing is recorded about this buyer. A reveal ends in an introduction, and a seller's patience is finite.",
        }
      : mayApproachSeller(context.passport);
  if (!approach.allowed) {
    blockers.push({
      reason: approach.reason,
      remedy:
        "Complete the Buyer Readiness Passport: identity, screening and evidence of funds. Spending a motivated seller's time on a buyer with no money is how a marketplace destroys its own supply, and the seller blames whoever introduced them.",
    });
  }

  if (context.openlyAdvertised === true) {
    blockers.push({
      reason: "This property is openly advertised elsewhere.",
      remedy:
        "Nothing is charged for it. The fee buys a verified pack and an introduction to somebody who agreed to be introduced; on a property with an agent's number already beside it on a portal, it would buy information the buyer could have had for nothing.",
    });
  }

  if (context.closed === true) {
    blockers.push({
      reason: "The property is sold, under offer or withdrawn.",
      remedy: "Nothing. There is no introduction left to make.",
    });
  }

  if (context.alreadyOpened === true) {
    blockers.push({
      reason: "This buyer has already opened this opportunity.",
      remedy: "Nothing. A reveal is charged once; a second one is a second charge for access they already have.",
    });
  }

  return {
    opportunity: context.opportunity,
    price: revealPrice(context.opportunity).standard,
    chargeable: blockers.length === 0,
    blockers,
    disclosure: definition.disclosure,
    guarantee: REVEAL_GUARANTEE,
    version: REVEAL_VERSION,
  };
}

/* --------------------------------------------------- the anonymous card */

/**
 * What a buyer sees before they have paid anything.
 *
 * Deliberately a small, closed shape rather than a filtered version of the
 * deal, because a filter is a list of things somebody remembered to remove and
 * this is a list of things somebody decided to include. Three kinds of thing
 * are absent by construction:
 *
 *  - **The address.** The whole product is the introduction. Giving away what
 *    is being introduced makes the fee a toll on information the buyer already
 *    has, which is the prohibited version of this business.
 *  - **The seller's situation.** Probate, arrears, divorce, illness. That is
 *    the seller's private information and it never leaves the platform — a
 *    marketplace that advertises distress is advertising the seller, not the
 *    property.
 *  - **Any return, yield or margin.** An invitation to engage in investment
 *    activity is a financial promotion under FSMA s.21 and needs approval by an
 *    authorised person. A card that says "18% margin" is one; a card that says
 *    "three-bed freehold house, guide £172,000" is not.
 */
export interface OpportunityCard {
  readonly reference: string;
  /** The postcode area, never the full postcode and never the street. */
  readonly area: string;
  readonly locality: string;
  readonly propertyType: PropertyType;
  readonly tenure: Tenure;
  readonly bedrooms: number;
  /** The guide price, as the seller's side would state it. */
  readonly guidePrice: Money;
  readonly category: InventoryCategory;
  /** The category sentence, verbatim. Shown with the card, never behind it. */
  readonly disclosure: string;
  readonly opportunity: OpportunityClass;
  /** What it costs to open it, from the catalogue. */
  readonly revealPrice: Money;
  /** True where it may actually be opened for money today. */
  readonly openable: boolean;
}

export interface CardInput {
  readonly reference: string;
  readonly property: PropertyFacts;
  readonly guidePrice: Money;
  readonly item: InventoryItem;
  readonly quote: RevealQuote;
}

export function opportunityCard(input: CardInput): OpportunityCard {
  return {
    reference: input.reference,
    area: input.property.postcodeArea,
    locality: input.property.locality,
    propertyType: input.property.propertyType,
    tenure: input.property.tenure,
    bedrooms: input.property.bedrooms,
    guidePrice: input.guidePrice,
    category: input.item.category,
    disclosure: categoryDefinition(input.item.category).disclosure,
    opportunity: input.quote.opportunity,
    revealPrice: input.quote.price,
    openable: input.quote.chargeable,
  };
}

/* ------------------------------------------------------------- refunds */

/**
 * Why a reveal fee is being given back.
 *
 * A closed list, because every one of these is a failure of the thing we sold
 * rather than a change of mind — which is what makes the refund automatic. A
 * buyer who simply decided against the property got what they paid for, and
 * saying so plainly is what keeps the guarantee meaningful for the cases that
 * are ours.
 */
export type RefundTrigger =
  | "seller-unreachable"
  | "already-sold"
  | "not-for-sale"
  | "materially-misdescribed";

export interface RefundReason {
  readonly trigger: RefundTrigger;
  readonly label: string;
  readonly explanation: string;
}

export const REFUND_REASONS: readonly RefundReason[] = [
  {
    trigger: "seller-unreachable",
    label: "The seller did not respond",
    explanation: `No response within ${SELLER_RESPONSE_DAYS} days of the introduction being made.`,
  },
  {
    trigger: "already-sold",
    label: "Already sold or under offer",
    explanation: "The property was not available at the moment the fee was taken.",
  },
  {
    trigger: "not-for-sale",
    label: "The owner says it is not for sale",
    explanation: "The confirmation we held was wrong, withdrawn, or never given.",
  },
  {
    trigger: "materially-misdescribed",
    label: "The pack was materially wrong",
    explanation: "A fact the buyer relied on to pay was not as described.",
  },
];

export function refundReason(trigger: RefundTrigger): RefundReason {
  const found = REFUND_REASONS.find((r) => r.trigger === trigger);
  if (found === undefined) throw new Error(`No refund reason for "${trigger}".`);
  return found;
}

export interface RefundClaim {
  readonly trigger: RefundTrigger;
  /** ISO-8601, when the fee was taken. */
  readonly paidAt: string;
  /** ISO-8601, when the claim was made. */
  readonly claimedAt: string;
}

export interface RefundDecision {
  readonly refund: boolean;
  /** The amount to return. The whole fee or nothing — never a proportion. */
  readonly amount: Money;
  readonly reason: string;
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return Number.NaN;
  return (end - start) / 86_400_000;
}

/**
 * Whether the fee comes back.
 *
 * The whole fee or none of it. A partial refund on a reveal is an argument
 * about how much of an introduction was delivered, and there is no honest way
 * to answer it — either the opportunity was what we sold or it was not.
 *
 * Nothing here needs a person to agree. That is the point of the guarantee:
 * "the refund is automatic; nobody has to be persuaded" is a promise this
 * function keeps, and the only reason it returns false is that the claim is
 * outside the window or the dates do not make sense.
 */
export function decideRefund(claim: RefundClaim, paid: Money): RefundDecision {
  const elapsed = daysBetween(claim.paidAt, claim.claimedAt);

  if (Number.isNaN(elapsed)) {
    return { refund: false, amount: ZERO, reason: "The dates on this claim cannot be read." };
  }
  if (elapsed < 0) {
    return {
      refund: false,
      amount: ZERO,
      reason: "The claim is dated before the payment, so one of the two is wrong.",
    };
  }
  if (elapsed > REFUND_WINDOW_DAYS) {
    return {
      refund: false,
      amount: ZERO,
      reason: `Claimed after the ${REFUND_WINDOW_DAYS}-day window, which was stated at the point of sale.`,
    };
  }

  const reason = refundReason(claim.trigger);
  return {
    refund: true,
    amount: paid,
    reason: `${reason.label}. ${reason.explanation} Refunded in full under the guarantee.`,
  };
}

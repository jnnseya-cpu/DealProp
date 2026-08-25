import { ZERO, type Money } from "@shared/money";
import {
  creditPack,
  plan,
  priceBreakdown,
  taxDecision,
  type CustomerTaxProfile,
  type PlanId,
  type PriceBreakdown,
} from "@shared/domain/pricing";
import { STREAMS, type RevenueStream } from "@shared/domain/revenue";

/**
 * The gate every charge passes through before any money is asked for.
 *
 * Note what a purchase request does **not** carry: an amount. There is no field
 * for one, in any of the shapes below, so there is nothing for a caller to set
 * to zero and nothing for a tampered form to override. A request names a plan
 * or a pack; the price comes from the catalogue on the server. This is
 * structural rather than validated, because a validated amount is only as good
 * as the validation, and the failure is silent and total.
 *
 * Four things are checked, in an order chosen so the most expensive mistake is
 * caught first:
 *
 *  1. **Is the item real?** An unknown plan or pack is refused, not defaulted.
 *  2. **May we lawfully charge for this at all?** Several revenue streams
 *     require a permission we do not yet hold. A fee charged without it is not
 *     merely a compliance problem: an unauthorised credit-broking fee is
 *     unenforceable, so it is money delivered against, taken, and then given
 *     back with a penalty on top.
 *  3. **Do we know the right tax treatment?** Guessing costs us the difference.
 *  4. **Is the account in good standing?** Somebody with a reversed payment
 *     outstanding does not get to buy more on the same card.
 */

export type PurchaseRequest =
  | { readonly kind: "plan"; readonly planId: PlanId }
  | { readonly kind: "topup"; readonly packId: string };

export interface ChargeContext {
  readonly customer: CustomerTaxProfile;
  /** Permissions actually recorded as held, from `revenue.ts`'s vocabulary. */
  readonly permissionsHeld: readonly string[];
  /** True where a reversal is outstanding against this account. */
  readonly owesUs: boolean;
}

export interface ChargeAuthorisation {
  readonly allowed: boolean;
  /** The price, decided here and nowhere else. Zero when refused. */
  readonly price: PriceBreakdown;
  /** What the customer is buying, for the description on their statement. */
  readonly description: string;
  /** Always populated. No silent refusals and no silent approvals. */
  readonly reason: string;
}

const REFUSED = (reason: string): ChargeAuthorisation => ({
  allowed: false,
  price: { gross: ZERO, net: ZERO, tax: ZERO, rateBps: 0, treatment: "not-supported" },
  description: "",
  reason,
});

/**
 * Which revenue stream a purchase belongs to.
 *
 * Subscriptions and prepaid usage are the two streams with no permission
 * dependency, which is exactly why they are the two things that may be sold
 * today. The rest — success fees, packaging, funding introductions — are
 * charged against a completed transaction rather than bought from a page, and
 * they are gated in `dealRevenue()` as well as here.
 */
function streamFor(request: PurchaseRequest): RevenueStream {
  return request.kind === "plan" ? "buyer-subscription" : "ai-credits";
}

export function authorisePurchase(
  request: PurchaseRequest,
  context: ChargeContext,
): ChargeAuthorisation {
  if (context.owesUs) {
    return REFUSED(
      "A previous payment was reversed after the balance was used and is still outstanding. Settle it before buying again.",
    );
  }

  const stream = STREAMS.find((s) => s.key === streamFor(request));
  if (stream === undefined) {
    return REFUSED("Unknown revenue stream.");
  }
  const permission = stream.requiresPermission;
  if (permission !== undefined && !context.permissionsHeld.includes(permission)) {
    return REFUSED(
      `${stream.label} cannot be charged yet: it requires ${permission}. Charging without it would make the fee unrecoverable as well as unlawful.`,
    );
  }

  const tax = taxDecision(context.customer);
  if (!tax.mayCharge) {
    return REFUSED(tax.reason);
  }

  if (request.kind === "plan") {
    const chosen = plan(request.planId);
    if (chosen === undefined) {
      return REFUSED(`No plan with id ${request.planId}.`);
    }
    if (chosen.price <= 0) {
      return REFUSED(
        `${chosen.name} costs nothing, so there is nothing to charge. Apply it directly rather than through checkout.`,
      );
    }
    return {
      allowed: true,
      price: priceBreakdown(chosen.price, chosen.statedAs, tax),
      description: `${chosen.name} — monthly`,
      reason: tax.reason,
    };
  }

  const pack = creditPack(request.packId);
  if (pack === undefined) {
    return REFUSED(`No credit pack with id ${request.packId}.`);
  }
  return {
    allowed: true,
    price: priceBreakdown(pack.price, pack.statedAs, tax),
    description: `Prepaid balance — £${(pack.balance / 100).toFixed(2)}${
      pack.bonus > 0 ? ` plus £${(pack.bonus / 100).toFixed(2)} bonus` : ""
    }`,
    reason: tax.reason,
  };
}

/**
 * What the provider must be told to take, in the smallest currency unit.
 *
 * A separate function with a name that says the unit, because the most
 * expensive arithmetic error available here is an order of magnitude: sending
 * `49` where the provider expects minor units charges 49p for a £49 plan, and
 * sending `4900` to one that expects major units charges £4,900. Both have
 * happened to other people. `Money` is already minor units, so this is a
 * documented identity rather than a conversion — and the place to change if a
 * provider that wants major units is ever added.
 */
export function amountInMinorUnits(price: PriceBreakdown): number {
  return price.gross as number;
}

/** The currency everything above is denominated in. */
export const CURRENCY = "GBP";

/**
 * A charge that has been authorised but not yet placed.
 *
 * Held so that the amount the provider is asked for and the amount later
 * confirmed by a webhook can be compared. Without that comparison, a webhook
 * saying "paid" is taken on trust for whatever figure it names, and the figure
 * it names is not necessarily the one we asked for.
 */
export interface PendingCharge {
  readonly id: string;
  readonly accountId: string;
  readonly request: PurchaseRequest;
  readonly expectedGross: Money;
  readonly currency: string;
  readonly createdAt: string;
  readonly idempotencyKey: string;
}

export interface ConfirmationCheck {
  readonly matches: boolean;
  readonly reason: string;
}

/**
 * Does what the provider says was paid match what we asked for?
 *
 * Underpayment is the obvious case. Overpayment is checked too, because it
 * usually means the confirmation belongs to a different charge, and applying it
 * to this one delivers the wrong thing and leaves a real payment unfulfilled.
 */
export function confirmationMatches(
  pending: PendingCharge,
  paid: { readonly amountMinorUnits: number; readonly currency: string },
): ConfirmationCheck {
  if (paid.currency.toUpperCase() !== pending.currency.toUpperCase()) {
    return {
      matches: false,
      reason: `Paid in ${paid.currency} against a charge raised in ${pending.currency}. A currency mismatch is never a rounding difference.`,
    };
  }
  if (paid.amountMinorUnits !== (pending.expectedGross as number)) {
    return {
      matches: false,
      reason: `Confirmation is for ${paid.amountMinorUnits} minor units against an expected ${pending.expectedGross}. Nothing is fulfilled on a mismatch.`,
    };
  }
  return { matches: true, reason: "The confirmed amount matches the authorised charge." };
}

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
import { permissionDefinition, type PermissionKey } from "@shared/domain/permissions";
import type { RevealQuote } from "@shared/domain/reveal";

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
  | { readonly kind: "topup"; readonly packId: string }
  /**
   * Opening one opportunity.
   *
   * Names the opportunity, never its class and never its price. The class is
   * derived on the server from the property and the price read from the
   * catalogue, because a request that could name its own class could buy a
   * portfolio disposal at the standard-residential price.
   */
  | { readonly kind: "reveal"; readonly opportunityId: string };

export interface ChargeContext {
  readonly customer: CustomerTaxProfile;
  /** Permissions actually recorded as held, from `revenue.ts`'s vocabulary. */
  readonly permissionsHeld: readonly PermissionKey[];
  /** True where a reversal is outstanding against this account. */
  readonly owesUs: boolean;
  /**
   * The reveal being bought, already quoted on the server.
   *
   * Required for a reveal request and ignored otherwise. Passed in rather than
   * looked up here because the quote needs the store, and this file is pure.
   */
  readonly reveal?: RevealQuote;
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
  switch (request.kind) {
    case "plan":
      return "buyer-subscription";
    case "topup":
      return "ai-credits";
    case "reveal":
      return "opportunity-reveal";
  }
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
  const missing = (stream.requiresPermissions ?? []).filter(
    (key) => !context.permissionsHeld.includes(key),
  );
  if (missing.length > 0) {
    const needed = missing.map((k) => permissionDefinition(k).label.toLowerCase()).join(" and ");
    return REFUSED(
      `${stream.label} cannot be charged yet: it requires ${needed}. Charging without it would make the fee unrecoverable as well as unlawful.`,
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

  if (request.kind === "reveal") {
    const quote = context.reveal;
    if (quote === undefined) {
      return REFUSED("No opportunity was quoted, so there is nothing to charge for.");
    }
    if (!quote.chargeable) {
      return REFUSED(quote.blockers.map((b) => b.reason).join(" "));
    }
    return {
      allowed: true,
      // Inclusive of VAT: this is a consumer-facing unlock at a stated price,
      // and a price that grows at checkout is the commonest reason a checkout
      // is abandoned.
      price: priceBreakdown(quote.price, "inclusive", tax),
      description: `Opportunity reveal — ${quote.opportunity.replace(/-/g, " ")}`,
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

export interface ConfirmationCheck {
  readonly matches: boolean;
  readonly reason: string;
}

/**
 * Does what the provider says was paid match what we would have charged?
 *
 * The expected figure is recomputed from the catalogue at the moment the
 * confirmation arrives, rather than read back from a charge we stored earlier.
 * One fewer table, one fewer thing to fall out of step, and the answer comes
 * from the same source that would have priced the sale.
 *
 * Underpayment is the obvious case. Overpayment is refused too, because it
 * usually means the confirmation belongs to a different charge — and applying
 * it here delivers the wrong thing while leaving a real payment unfulfilled.
 */
export function confirmationMatches(
  expected: { readonly gross: Money; readonly currency: string },
  paid: { readonly amountMinorUnits: number | undefined; readonly currency: string | undefined },
): ConfirmationCheck {
  const paidCurrency = (paid.currency ?? CURRENCY).toUpperCase();
  if (paidCurrency !== expected.currency.toUpperCase()) {
    return {
      matches: false,
      reason: `Paid in ${paidCurrency} against a charge raised in ${expected.currency}. A currency mismatch is never a rounding difference.`,
    };
  }
  if (paid.amountMinorUnits !== (expected.gross as number)) {
    return {
      matches: false,
      reason: `Confirmation is for ${String(paid.amountMinorUnits)} minor units against an expected ${expected.gross}. Nothing is fulfilled on a mismatch.`,
    };
  }
  return { matches: true, reason: "The confirmed amount matches the catalogue price." };
}

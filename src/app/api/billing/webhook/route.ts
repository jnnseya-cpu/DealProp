import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { money, ZERO } from "@shared/money";
import {
  creditPack,
  DISPUTE_FEE,
  GRANTED_CREDIT_MONTHS,
  plan,
  priceBreakdown,
  PURCHASED_CREDIT_MONTHS,
  taxDecision,
  type CustomerKind,
} from "@shared/domain/pricing";
import { expiryFrom } from "@shared/domain/ledger";
import { confirmationMatches, CURRENCY } from "@shared/domain/charging";
import { entitlementsFor, periodAllowance } from "@shared/domain/entitlements";
import type { Subscription, SubscriptionStatus } from "@shared/domain/entitlements";
import { isHandledEvent, verifyWebhook, type BillingEventType } from "@backend/billing/webhook";
import { mayStartTrial } from "@shared/domain/accounts";
import {
  applyTopUp,
  claimBillingEvent,
  getAccount,
  getSubscription,
  saveAccount,
  recordNote,
  reverseLotsForPayment,
  saveSubscription,
} from "@backend/store/repository";

export const dynamic = "force-dynamic";

/**
 * Payment confirmations from the provider.
 *
 * Everything money-related that arrives from outside comes through here, which
 * makes it the highest-value target on the platform: a caller believed here
 * awards itself a subscription and any amount of prepaid balance, free, on
 * repeat. Five things stand between it and that, and all five are required.
 *
 *  1. **The signature is verified over the raw bytes** before the body is
 *     parsed at all. Nothing below runs on an unverified payload.
 *  2. **The event id is claimed exactly once**, in the store, atomically.
 *     Providers redeliver by design and a second delivery must do nothing.
 *  3. **The event type is on an allowlist.** An unfamiliar type is recorded and
 *     ignored, never handled by a fall-through.
 *  4. **The amount is recomputed from the catalogue and compared.** What the
 *     event says was paid has to equal what this platform would have charged.
 *     Nothing is fulfilled on a mismatch, in either direction — an overpayment
 *     usually means the confirmation belongs to a different charge.
 *  5. **Subscription changes are applied only if newer** than the change
 *     already recorded. Webhooks arrive out of order, and a late `renewed`
 *     event landing after a `canceled` one turns the subscription back on for
 *     somebody who has stopped paying.
 *
 * The response is 200 for anything successfully understood — including a
 * duplicate and an ignored type — because a provider that receives an error
 * retries, and retrying will not fix either. It is 400 only where the delivery
 * itself is bad, and 401 where it is not from the provider at all.
 *
 * What remains to do: the field names below are the shape this platform
 * normalises to, not any particular provider's payload. Adding a provider means
 * writing the mapping into this shape; it does not mean changing any of the
 * five defences.
 */

interface BillingEvent {
  readonly id: string;
  readonly type: BillingEventType;
  readonly accountId: string;
  /** The provider's payment id, which a later refund or dispute names. */
  readonly paymentReference?: string;
  readonly amountMinorUnits?: number;
  /** On a refund: the cash actually returned. Absent means the whole payment. */
  readonly refundedMinorUnits?: number;
  readonly currency?: string;
  readonly packId?: string;
  readonly planId?: string;
  readonly customerCountry?: string;
  readonly customerKind?: CustomerKind;
  readonly periodStart?: string;
  readonly periodEnd?: string;
  /** When the provider raised this, for ordering. */
  readonly occurredAt?: string;
}

function ok(reason: string): NextResponse {
  return NextResponse.json({ status: "ok", reason }, { status: 200, headers: NO_STORE });
}

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request): Promise<NextResponse> {
  // The exact bytes. Parsing first and re-serialising produces different bytes
  // and a signature that can never match, which tends to get "fixed" by
  // removing the check.
  const raw = await request.text();
  const verification = verifyWebhook(raw, request.headers.get("x-billing-signature"));

  if (!verification.ok) {
    // The reason goes to the log, not to the caller. Whoever can read the log
    // is entitled to know why; whoever can post to this endpoint is not, and
    // telling them turns it into an oracle for guessing the signature.
    process.stderr.write(`billing webhook refused: ${verification.failure}\n`);
    return NextResponse.json({ status: "refused" }, { status: 401, headers: NO_STORE });
  }

  let event: BillingEvent;
  try {
    event = JSON.parse(raw) as BillingEvent;
  } catch {
    return NextResponse.json({ status: "unreadable" }, { status: 400, headers: NO_STORE });
  }

  if (typeof event.id !== "string" || event.id === "" || typeof event.type !== "string") {
    return NextResponse.json({ status: "unreadable" }, { status: 400, headers: NO_STORE });
  }

  if (!isHandledEvent(event.type)) {
    // Recorded rather than errored: an unknown type is not a failure the
    // provider can fix by sending it again.
    return ok(`Event type ${event.type} is not handled.`);
  }

  const at = new Date().toISOString();
  const claimed = await claimBillingEvent(event.id, event.type, at);
  if (!claimed) {
    return ok("Already processed.");
  }

  if (typeof event.accountId !== "string" || event.accountId === "") {
    return NextResponse.json({ status: "unreadable" }, { status: 400, headers: NO_STORE });
  }

  try {
    switch (event.type) {
      case "payment.succeeded":
        return await handlePayment(event, at);
      case "payment.refunded":
      case "payment.disputed":
        return await handleReversal(event, at);
      case "subscription.trial_started":
        return await handleTrial(event, at);
      case "subscription.activated":
      case "subscription.renewed":
      case "subscription.payment_failed":
      case "subscription.canceled":
        return await handleSubscription(event, at);
    }
  } catch (error) {
    // A failure here means the event was claimed but not applied, which is the
    // one case worth a 500: the provider retries, the claim is already held, and
    // the discrepancy has to be reconciled by hand rather than papered over by a
    // duplicate. Logged loudly for exactly that reason.
    process.stderr.write(`billing webhook ${event.id} claimed but not applied: ${String(error)}\n`);
    return NextResponse.json({ status: "error" }, { status: 500, headers: NO_STORE });
  }
}

/**
 * A completed payment for prepaid balance.
 *
 * The balance granted comes from the catalogue, never from the event. The event
 * is only allowed to say *which* pack and *how much was taken*, and the second
 * has to agree with what this platform would have charged for the first.
 */
async function handlePayment(event: BillingEvent, at: string): Promise<NextResponse> {
  const pack = event.packId === undefined ? undefined : creditPack(event.packId);
  if (pack === undefined) {
    process.stderr.write(`billing webhook ${event.id}: unknown pack ${String(event.packId)}\n`);
    return ok("No such credit pack. Nothing applied.");
  }

  const tax = taxDecision({
    country: event.customerCountry ?? "GB",
    kind: event.customerKind ?? "consumer",
  });
  const expected = priceBreakdown(pack.price, pack.statedAs, tax);

  const check = confirmationMatches(
    { gross: expected.gross, currency: CURRENCY },
    { amountMinorUnits: event.amountMinorUnits, currency: event.currency },
  );
  if (!check.matches) {
    process.stderr.write(`billing webhook ${event.id}: ${check.reason}\n`);
    return ok(`${check.reason} Nothing applied.`);
  }

  const paymentReference = event.paymentReference ?? event.id;

  const result = await applyTopUp({
    accountId: event.accountId,
    // Keyed on the provider's payment, not on the delivery: two different
    // events describing one payment must still apply it once.
    idempotencyKey: `topup:${paymentReference}`,
    at,
    purchased: {
      lotId: randomUUID(),
      amount: pack.balance,
      cashGross: expected.gross,
      cashTax: expected.tax,
      expiresAt: expiryFrom(at, PURCHASED_CREDIT_MONTHS),
    },
    ...(pack.bonus > ZERO
      ? {
          granted: {
            lotId: randomUUID(),
            amount: pack.bonus,
            expiresAt: expiryFrom(at, GRANTED_CREDIT_MONTHS),
          },
        }
      : {}),
    paymentReference,
    entryIdPrefix: randomUUID(),
    reason: `Top-up ${pack.id}`,
  });

  return ok(result.duplicate ? "Already applied." : "Balance added.");
}

/**
 * A refund or a dispute.
 *
 * Both reverse the lots the payment created, spent or not. A dispute also
 * suspends the account: somebody who has taken the money back after using the
 * service does not carry on using it while the dispute is decided.
 */
async function handleReversal(event: BillingEvent, at: string): Promise<NextResponse> {
  const paymentReference = event.paymentReference ?? event.id;
  const dispute = event.type === "payment.disputed";

  // A dispute always takes the whole payment. A refund may be partial, and
  // treating a partial refund as a full one strips balance the customer still
  // owns — which produces a second dispute, from a customer who is by then
  // right.
  const refundedGross =
    dispute || event.refundedMinorUnits === undefined
      ? ("full" as const)
      : money(event.refundedMinorUnits);

  const result = await reverseLotsForPayment({
    paymentReference,
    refundedGross,
    kind: dispute ? "chargeback" : "refund",
    at,
    entryIdPrefix: randomUUID(),
  });

  if (dispute) {
    // The provider charges a fee whichever way the dispute goes, so it is a
    // cost we have already incurred. Recorded against the account it arose from
    // and kept apart from what the customer owes, because winning the dispute
    // does not give it back.
    await recordNote({
      accountId: event.accountId,
      idempotencyKey: `fee:${paymentReference}`,
      at,
      kind: "fee",
      amount: money(-DISPUTE_FEE),
      entryId: randomUUID(),
      reference: paymentReference,
      reason: "Dispute fee charged by the payment provider.",
    });

    const existing = await getSubscription(event.accountId);
    if (existing !== undefined) {
      await saveSubscription({
        ...existing,
        status: "blocked",
        blockedReason:
          "A payment was disputed. Access is suspended until the dispute is resolved and any balance already used is settled.",
        lastEventAt: event.occurredAt ?? at,
        lastEventId: event.id,
      });
    }
  }

  return ok(
    `${result.lotsReversed} lot(s) reversed, £${(result.balanceRemoved / 100).toFixed(2)} removed${
      result.debt > 0 ? `, £${(result.debt / 100).toFixed(2)} owed` : ""
    }.`,
  );
}

/**
 * The balance a paid plan includes, granted once per period.
 *
 * Keyed on the period rather than the event, so a renewal delivered twice — or
 * an `activated` and a `renewed` describing the same period — grants it once.
 * It expires when the period does: an allowance that rolls over is not an
 * allowance, it is a discount that compounds.
 */
async function grantPeriodAllowance(subscription: Subscription, at: string): Promise<void> {
  const entitlements = entitlementsFor(subscription, new Date(at));
  const allowance = periodAllowance(entitlements);
  if (allowance <= ZERO) return;

  await applyTopUp({
    accountId: subscription.accountId,
    idempotencyKey: `allowance:${subscription.id}:${subscription.currentPeriodStart}`,
    at,
    // Granted, not purchased: a plan allowance was never paid for separately,
    // so there is no cash behind it and none can come back out of it.
    purchased: {
      lotId: randomUUID(),
      amount: ZERO,
      cashGross: ZERO,
      cashTax: ZERO,
      expiresAt: subscription.currentPeriodEnd,
    },
    granted: {
      lotId: randomUUID(),
      amount: allowance,
      expiresAt: subscription.currentPeriodEnd,
    },
    paymentReference: `plan:${subscription.id}:${subscription.currentPeriodStart}`,
    entryIdPrefix: randomUUID(),
    reason: `${entitlements.planId} allowance for the period from ${subscription.currentPeriodStart.slice(0, 10)}`,
  });
}

/**
 * Starting a free trial.
 *
 * Separate from every other subscription event because it is the only one that
 * hands over the product without a payment, which makes it the only one worth
 * abusing by repetition. One per account, recorded on the account itself so
 * cancelling and starting again does not reset it.
 *
 * What this does not solve is somebody registering a second account with a
 * second address. Nothing in the application layer can; that belongs at the
 * payment provider, which can see the card, and to requiring a payment method
 * up front. Both are written down as outstanding rather than quietly assumed.
 */
async function handleTrial(event: BillingEvent, at: string): Promise<NextResponse> {
  const account = await getAccount(event.accountId);
  if (account === undefined) {
    return ok("No such account. Nothing applied.");
  }

  const decision = mayStartTrial(account);
  if (!decision.allowed) {
    process.stderr.write(`billing webhook ${event.id}: trial refused — ${decision.reason}\n`);
    return ok(decision.reason);
  }

  const chosen = event.planId === undefined ? undefined : plan(event.planId as never);
  if (chosen === undefined) {
    return ok("No plan named for the trial. Nothing applied.");
  }

  const existing = await getSubscription(event.accountId);
  const occurredAt = event.occurredAt ?? at;

  await saveAccount({ ...account, trialClaimedAt: occurredAt });
  await saveSubscription({
    id: existing?.id ?? randomUUID(),
    accountId: event.accountId,
    planId: chosen.id,
    status: "trialing",
    currentPeriodStart: event.periodStart ?? at,
    currentPeriodEnd: event.periodEnd ?? at,
    trialEndsAt: event.periodEnd ?? at,
    lastEventAt: occurredAt,
    lastEventId: event.id,
  });

  // No allowance is granted. A trial unlocks the features and none of the
  // things whose whole value transfers on first use.
  return ok(`Trial started on ${chosen.name}.`);
}

/** Statuses this platform recognises, mapped from the event that carries them. */
const STATUS_FOR: Record<string, SubscriptionStatus> = {
  "subscription.activated": "active",
  "subscription.renewed": "active",
  "subscription.payment_failed": "past-due",
  "subscription.canceled": "canceled",
};

async function handleSubscription(event: BillingEvent, at: string): Promise<NextResponse> {
  const status = STATUS_FOR[event.type];
  if (status === undefined) return ok("No status change.");

  const chosen = event.planId === undefined ? undefined : plan(event.planId as never);
  const existing = await getSubscription(event.accountId);
  const occurredAt = event.occurredAt ?? at;

  // Out-of-order delivery. A `renewed` event raised before a `canceled` one but
  // delivered after it would otherwise switch the subscription back on for
  // somebody who has stopped paying.
  if (existing?.lastEventAt !== undefined && occurredAt < existing.lastEventAt) {
    return ok("A newer change is already recorded. Ignored.");
  }

  // A suspension is not undone by an ordinary subscription event. Lifting it is
  // a decision somebody makes, not something a renewal does by arriving.
  if (existing?.status === "blocked") {
    return ok("The account is suspended. No subscription event lifts that on its own.");
  }

  const planId = chosen?.id ?? existing?.planId;
  if (planId === undefined) {
    process.stderr.write(`billing webhook ${event.id}: no plan for ${event.accountId}\n`);
    return ok("No plan named and none on record. Nothing applied.");
  }

  const subscription: Subscription = {
    id: existing?.id ?? randomUUID(),
    accountId: event.accountId,
    planId,
    status,
    currentPeriodStart: event.periodStart ?? existing?.currentPeriodStart ?? at,
    currentPeriodEnd: event.periodEnd ?? existing?.currentPeriodEnd ?? at,
    ...(status === "past-due"
      ? { delinquentSince: existing?.delinquentSince ?? occurredAt }
      : {}),
    ...(status === "canceled" ? { canceledAt: occurredAt } : {}),
    ...(existing?.immediateSupplyConsent !== undefined
      ? { immediateSupplyConsent: existing.immediateSupplyConsent }
      : {}),
    ...(existing?.trialEndsAt !== undefined ? { trialEndsAt: existing.trialEndsAt } : {}),
    ...(existing?.providerCustomerId !== undefined
      ? { providerCustomerId: existing.providerCustomerId }
      : {}),
    lastEventAt: occurredAt,
    lastEventId: event.id,
  };

  await saveSubscription(subscription);

  // Only on a period that is actually paid for. A failed payment or a
  // cancellation must not hand over another month of credits on its way out.
  if (status === "active") {
    await grantPeriodAllowance(subscription, at);
  }

  return ok(`Subscription ${status}.`);
}

import type { BillingEvent, BillingEventType } from "@backend/billing/webhook";

/**
 * The Stripe adapter.
 *
 * Everything else in the billing code is provider-agnostic on purpose, and
 * this is the one file that knows a provider's names. Two directions:
 *
 *  - **Outbound.** Stripe's Checkout Sessions API is form-encoded, not JSON,
 *    and prices are given as line items rather than as an amount. That single
 *    fact is why a generic JSON `POST {amount}` adapter cannot talk to it, and
 *    why this file exists rather than a configuration value.
 *  - **Inbound.** Stripe's event shape is `{id, type, data: {object}}` with the
 *    interesting fields buried in `object`, and its type vocabulary is its own.
 *    `normaliseStripeEvent()` maps it into the shape the webhook route already
 *    handles — and maps *only* the types we act on, so a new Stripe event type
 *    arrives as "not handled" rather than as something half-understood.
 *
 * What this file deliberately does not do is change any of the five defences
 * in the webhook route. The signature scheme Stripe uses — `t=…,v1=…` over
 * `${timestamp}.${rawBody}` with HMAC-SHA256 — is already exactly what
 * `verifyWebhook()` implements, so the adapter adds a header name and nothing
 * else. If a future provider signs differently, that is a change to
 * `webhook.ts` and it should be visible as one.
 */

/**
 * The header Stripe signs with.
 *
 * Both are accepted: `x-billing-signature` is this platform's own name and is
 * what the tests and any non-Stripe provider use. Accepting two header names
 * is not a weakening — the signature is checked identically either way, and
 * the secret is the control.
 */
export const STRIPE_SIGNATURE_HEADER = "stripe-signature";
export const NATIVE_SIGNATURE_HEADER = "x-billing-signature";

export function signatureHeaderFrom(headers: Headers): string | null {
  return headers.get(NATIVE_SIGNATURE_HEADER) ?? headers.get(STRIPE_SIGNATURE_HEADER);
}

/* --------------------------------------------------------------- inbound */

/**
 * Stripe's event types, mapped to ours.
 *
 * A closed map, so an event type Stripe adds later is unmapped and therefore
 * unhandled. That is the correct outcome: a payment platform that guesses at
 * an event it has never seen is a payment platform that acts on a meaning
 * somebody else chose.
 *
 * `checkout.session.completed` rather than `payment_intent.succeeded`, because
 * the session is what carries our metadata and what the customer actually
 * finished. The payment intent fires too, and mapping both would apply one
 * purchase twice — the event-id claim would not catch it, because they are
 * genuinely different events.
 */
export const STRIPE_EVENT_MAP: Readonly<Record<string, BillingEventType>> = {
  "checkout.session.completed": "payment.succeeded",
  "charge.refunded": "payment.refunded",
  "charge.dispute.created": "payment.disputed",
  "customer.subscription.trial_will_end": "subscription.trial_started",
  "customer.subscription.created": "subscription.activated",
  "invoice.paid": "subscription.renewed",
  "invoice.payment_failed": "subscription.payment_failed",
  "customer.subscription.deleted": "subscription.canceled",
};

/** Anything at all, read defensively. Nothing here trusts a shape. */
type Unknown = Record<string, unknown>;

function object(value: unknown): Unknown | undefined {
  return typeof value === "object" && value !== null ? (value as Unknown) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function whole(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function seconds(value: unknown): string | undefined {
  const n = whole(value);
  return n === undefined ? undefined : new Date(n * 1000).toISOString();
}

/**
 * True where this looks like a Stripe event rather than our own shape.
 *
 * Checked on the type vocabulary rather than on a version field, because the
 * question that matters is "do I know how to read this", and a payload
 * claiming a version it does not have is exactly what an adapter should not
 * believe.
 */
export function looksLikeStripe(parsed: Unknown): boolean {
  const type = text(parsed.type);
  return type !== undefined && Object.prototype.hasOwnProperty.call(STRIPE_EVENT_MAP, type);
}

/**
 * Map a Stripe event into the shape the route handles.
 *
 * Returns undefined where the event is one we do not act on, or where the
 * fields that decide who to credit are absent. Undefined is the safe answer:
 * the route treats it as unhandled and does nothing, rather than crediting a
 * guess.
 *
 * The account id comes from metadata we set when the session was created, and
 * from nowhere else. An email or a customer id would be a second identity to
 * keep in step, and the failure would be crediting the wrong person.
 */
export function normaliseStripeEvent(parsed: Unknown): BillingEvent | undefined {
  const stripeType = text(parsed.type);
  const id = text(parsed.id);
  if (stripeType === undefined || id === undefined) return undefined;

  const mapped = STRIPE_EVENT_MAP[stripeType];
  if (mapped === undefined) return undefined;

  const data = object(parsed.data);
  const body = data === undefined ? undefined : object(data.object);
  if (body === undefined) return undefined;

  // Metadata sits on the session for a checkout and on the parent object for
  // a subscription invoice; both are read, and neither is inferred.
  const metadata = object(body.metadata) ?? {};
  const accountId = text(metadata.accountId);
  if (accountId === undefined) return undefined;

  const currency = text(body.currency)?.toUpperCase();
  const details = object(body.customer_details);
  const address = details === undefined ? undefined : object(details.address);

  const amount =
    whole(body.amount_total) ?? whole(body.amount) ?? whole(body.amount_paid) ?? undefined;

  return {
    id,
    type: mapped,
    accountId,
    ...(text(body.payment_intent) !== undefined
      ? { paymentReference: text(body.payment_intent) }
      : text(body.id) !== undefined
        ? { paymentReference: text(body.id) }
        : {}),
    ...(amount !== undefined ? { amountMinorUnits: amount } : {}),
    ...(whole(body.amount_refunded) !== undefined
      ? { refundedMinorUnits: whole(body.amount_refunded) }
      : {}),
    ...(currency !== undefined ? { currency } : {}),
    ...(text(metadata.packId) !== undefined ? { packId: text(metadata.packId) } : {}),
    ...(text(metadata.opportunityId) !== undefined
      ? { opportunityId: text(metadata.opportunityId) }
      : {}),
    ...(text(metadata.chargeId) !== undefined ? { chargeId: text(metadata.chargeId) } : {}),
    ...(text(metadata.planId) !== undefined ? { planId: text(metadata.planId) } : {}),
    ...(text(address?.country) !== undefined ? { customerCountry: text(address?.country) } : {}),
    ...(metadata.customerKind === "business" || metadata.customerKind === "consumer"
      ? { customerKind: metadata.customerKind }
      : {}),
    ...(seconds(body.period_start) !== undefined ? { periodStart: seconds(body.period_start) } : {}),
    ...(seconds(body.period_end) !== undefined ? { periodEnd: seconds(body.period_end) } : {}),
    ...(seconds(parsed.created) !== undefined ? { occurredAt: seconds(parsed.created) } : {}),
  };
}

/* -------------------------------------------------------------- outbound */

export interface StripeSessionRequest {
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly description: string;
  readonly chargeId: string;
  readonly accountId: string;
  readonly returnUrl: string;
  readonly cancelUrl: string;
  readonly metadata: Readonly<Record<string, string>>;
}

/**
 * The Checkout Session body, form-encoded.
 *
 * Stripe takes `application/x-www-form-urlencoded` with bracketed keys, not
 * JSON. Building it here rather than in the generic charge path keeps the
 * bracket syntax in the one file that is allowed to know about it.
 *
 * `price_data` with an inline amount rather than a Stripe Price id, because
 * the price this platform charges comes from `pricing.ts` and creating a
 * mirror of the catalogue in Stripe's dashboard is creating a second place
 * that states a price — which is the thing the catalogue exists to prevent.
 */
export function stripeSessionBody(request: StripeSessionRequest): URLSearchParams {
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", request.returnUrl);
  form.set("cancel_url", request.cancelUrl);
  form.set("client_reference_id", request.chargeId);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", request.currency.toLowerCase());
  form.set("line_items[0][price_data][unit_amount]", String(request.amountMinorUnits));
  form.set("line_items[0][price_data][product_data][name]", request.description);
  // Needed for the tax country on the event, and for a receipt anybody can
  // reconcile. Stripe will not return an address unless it is asked for.
  form.set("billing_address_collection", "required");

  for (const [key, value] of Object.entries(request.metadata)) {
    form.set(`metadata[${key}]`, value);
    // Also on the payment intent, so a refund or dispute event — which does
    // not carry the session — still says whose account it belongs to.
    form.set(`payment_intent_data[metadata][${key}]`, value);
  }
  form.set("metadata[chargeId]", request.chargeId);
  form.set("metadata[accountId]", request.accountId);
  form.set("payment_intent_data[metadata][chargeId]", request.chargeId);
  form.set("payment_intent_data[metadata][accountId]", request.accountId);

  return form;
}

/** True where the configured checkout URL is Stripe's. */
export function isStripeEndpoint(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith("stripe.com");
  } catch {
    return false;
  }
}

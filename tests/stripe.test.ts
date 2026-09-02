import { describe, expect, it } from "vitest";
import {
  isStripeEndpoint,
  looksLikeStripe,
  normaliseStripeEvent,
  signatureHeaderFrom,
  STRIPE_EVENT_MAP,
  stripeSessionBody,
} from "@backend/billing/stripe";
import { HANDLED_EVENTS, signPayload, verifyWebhook } from "@backend/billing/webhook";

/**
 * The Stripe adapter.
 *
 * One file knows a provider's names, and these are the tests that keep it
 * honest: that it maps only what we act on, that it never invents an account
 * to credit, and that the signature scheme it relies on is the one already
 * implemented rather than a second one nobody reviewed.
 */

describe("which events are mapped", () => {
  it("maps only into the vocabulary the route already handles", () => {
    // A mapping onto a type the route does not handle is a mapping that
    // silently does nothing, which reads like an implemented feature.
    for (const [stripeType, ours] of Object.entries(STRIPE_EVENT_MAP)) {
      expect(HANDLED_EVENTS, stripeType).toContain(ours);
    }
  });

  it("does not map both the session and the payment intent to one purchase", () => {
    // Stripe fires checkout.session.completed and payment_intent.succeeded for
    // the same purchase. Mapping both applies it twice, and the event-id claim
    // would not catch it — they are genuinely different events.
    expect(STRIPE_EVENT_MAP["checkout.session.completed"]).toBe("payment.succeeded");
    expect(STRIPE_EVENT_MAP["payment_intent.succeeded"]).toBeUndefined();
  });

  it("treats an unmapped Stripe type as not ours to read", () => {
    expect(looksLikeStripe({ type: "customer.created" })).toBe(false);
    expect(normaliseStripeEvent({ id: "evt_1", type: "customer.created" })).toBeUndefined();
  });
});

describe("reading a Stripe event", () => {
  const session = (over: Record<string, unknown> = {}) => ({
    id: "evt_1",
    type: "checkout.session.completed",
    created: 1_788_000_000,
    data: {
      object: {
        id: "cs_test_1",
        payment_intent: "pi_1",
        amount_total: 10_000,
        currency: "gbp",
        customer_details: { address: { country: "GB" } },
        metadata: { accountId: "acc-1", chargeId: "chg-1", packId: "topup-100" },
        ...over,
      },
    },
  });

  it("normalises into the shape the route reads", () => {
    const event = normaliseStripeEvent(session());
    expect(event?.type).toBe("payment.succeeded");
    expect(event?.id).toBe("evt_1");
    expect(event?.accountId).toBe("acc-1");
    expect(event?.chargeId).toBe("chg-1");
    expect(event?.packId).toBe("topup-100");
    expect(event?.amountMinorUnits).toBe(10_000);
    expect(event?.currency).toBe("GBP");
    expect(event?.customerCountry).toBe("GB");
    expect(event?.paymentReference).toBe("pi_1");
  });

  it("refuses an event with no account in the metadata", () => {
    // The account comes from metadata we set and from nowhere else. An email
    // or a customer id would be a second identity to keep in step, and the
    // failure would be crediting the wrong person.
    expect(normaliseStripeEvent(session({ metadata: {} }))).toBeUndefined();
    expect(
      normaliseStripeEvent(session({ metadata: { customer_email: "someone@example.com" } })),
    ).toBeUndefined();
  });

  it("refuses a payload with nothing where the object should be", () => {
    expect(normaliseStripeEvent({ id: "evt_1", type: "checkout.session.completed" })).toBeUndefined();
    expect(
      normaliseStripeEvent({ id: "evt_1", type: "checkout.session.completed", data: {} }),
    ).toBeUndefined();
  });

  it("reads a reveal purchase, which is not balance", () => {
    const event = normaliseStripeEvent(
      session({ metadata: { accountId: "acc-1", opportunityId: "deal-0001" } }),
    );
    expect(event?.opportunityId).toBe("deal-0001");
    expect(event?.packId).toBeUndefined();
  });

  it("ignores a number that is not a whole amount", () => {
    const event = normaliseStripeEvent(session({ amount_total: 99.5 }));
    expect(event?.amountMinorUnits).toBeUndefined();
  });
});

describe("the signature", () => {
  it("is the scheme already implemented, so the adapter adds a header name and nothing else", () => {
    // If a provider signed differently that would be a change to webhook.ts,
    // and it should be visible as one rather than hidden in an adapter.
    const secret = "whsec_test";
    const body = JSON.stringify({ id: "evt_1" });
    const timestamp = Math.floor(Date.parse("2026-09-01T00:00:00.000Z") / 1000);
    const header = signPayload(body, timestamp, secret);

    const verified = verifyWebhook(body, header, new Date("2026-09-01T00:00:30.000Z"), secret);
    expect(verified.ok).toBe(true);
  });

  it("accepts either header name and prefers our own", () => {
    const both = new Headers({
      "x-billing-signature": "t=1,v1=aa",
      "stripe-signature": "t=2,v1=bb",
    });
    expect(signatureHeaderFrom(both)).toBe("t=1,v1=aa");

    const stripeOnly = new Headers({ "stripe-signature": "t=2,v1=bb" });
    expect(signatureHeaderFrom(stripeOnly)).toBe("t=2,v1=bb");

    expect(signatureHeaderFrom(new Headers())).toBeNull();
  });
});

describe("creating the checkout session", () => {
  const request = {
    amountMinorUnits: 9_900,
    currency: "GBP",
    description: "Opportunity reveal — owner verified",
    chargeId: "chg-1",
    accountId: "acc-1",
    returnUrl: "https://lode.example/account/billing/complete",
    cancelUrl: "https://lode.example/account/billing",
    metadata: { opportunityId: "deal-0001" },
  };

  it("sends the amount as an inline line item rather than a Stripe price id", () => {
    // A Price created in Stripe's dashboard is a second place that states a
    // price, which is the thing pricing.ts exists to prevent.
    const form = stripeSessionBody(request);
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("9900");
    expect(form.get("line_items[0][price_data][currency]")).toBe("gbp");
    expect(form.get("mode")).toBe("payment");
    expect(form.get("price")).toBeNull();
  });

  it("puts the account and charge on the payment intent as well as the session", () => {
    // A refund or dispute event carries the payment intent, not the session.
    // Without this the reversal would arrive with nobody to attribute it to.
    const form = stripeSessionBody(request);
    expect(form.get("payment_intent_data[metadata][accountId]")).toBe("acc-1");
    expect(form.get("payment_intent_data[metadata][chargeId]")).toBe("chg-1");
    expect(form.get("payment_intent_data[metadata][opportunityId]")).toBe("deal-0001");
  });

  it("asks for the billing address, because the tax country decides the charge", () => {
    expect(stripeSessionBody(request).get("billing_address_collection")).toBe("required");
  });

  it("recognises a Stripe endpoint without being fooled by a lookalike host", () => {
    expect(isStripeEndpoint("https://api.stripe.com/v1/checkout/sessions")).toBe(true);
    expect(isStripeEndpoint("https://payments.example.com/checkout")).toBe(false);
    expect(isStripeEndpoint("https://api.stripe.com.evil.example/v1")).toBe(false);
    expect(isStripeEndpoint("not a url")).toBe(false);
  });
});

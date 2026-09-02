import { createHmac, timingSafeEqual } from "node:crypto";
import type { CustomerKind } from "@shared/domain/pricing";

/**
 * Verifying that a payment confirmation actually came from the payment provider.
 *
 * This is the single most dangerous endpoint on the platform. It is
 * unauthenticated by necessity — the provider has no account here — and what it
 * says is taken as proof that money arrived. An endpoint that believes its
 * caller is an endpoint where anybody with the URL awards themselves a
 * subscription and any amount of prepaid balance, for nothing, repeatedly.
 *
 * Four defences, all of which are required and none of which is sufficient
 * alone:
 *
 *  1. **A signature over the raw body**, using a secret shared only with the
 *     provider. Computed over the exact bytes received: parsing and
 *     re-serialising changes them, and a signature over re-serialised JSON
 *     verifies nothing about what was sent.
 *  2. **A timestamp inside the signed payload**, checked against a tolerance,
 *     so a valid request captured today cannot be replayed next month.
 *  3. **Constant-time comparison**, so the signature cannot be discovered a
 *     byte at a time by measuring how long the rejection takes.
 *  4. **Event-level idempotency**, enforced by the store rather than here.
 *     Providers deliver more than once by design; a delivery that is processed
 *     twice grants the balance twice.
 *
 * It fails closed. With no secret configured, nothing is accepted — the same
 * rule the cron endpoint and the operator gate follow, and for the same reason:
 * an unconfigured deployment must not be a permissive one.
 */

export type VerificationFailure =
  | "not-configured"
  | "missing-signature"
  | "malformed-signature"
  | "stale"
  | "bad-signature";

export interface VerificationResult {
  readonly ok: boolean;
  readonly failure?: VerificationFailure;
  /** Safe to log. Never contains the signature or the secret. */
  readonly reason: string;
}

/**
 * How far out of step with the provider's clock a delivery may be.
 *
 * Five minutes covers clock drift and a slow retry. Longer is a replay window;
 * much shorter starts rejecting legitimate deliveries during an outage.
 */
export const TOLERANCE_SECONDS = 300;

/**
 * The header format: `t=<unix seconds>,v1=<hex hmac>`.
 *
 * Modelled on what the major providers send, and parsed strictly. A tolerant
 * parser here is a parser that can be talked into accepting something.
 */
export function parseSignatureHeader(
  header: string | null,
): { timestamp: number; signature: string } | undefined {
  if (header === null || header.trim() === "") return undefined;

  let timestamp: number | undefined;
  let signature: string | undefined;

  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === undefined || value === undefined) continue;
    if (key.trim() === "t") {
      const parsed = Number(value.trim());
      if (Number.isInteger(parsed) && parsed > 0) timestamp = parsed;
    }
    if (key.trim() === "v1" && /^[0-9a-f]+$/i.test(value.trim())) {
      signature = value.trim().toLowerCase();
    }
  }

  if (timestamp === undefined || signature === undefined) return undefined;
  return { timestamp, signature };
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Verify a delivery.
 *
 * `rawBody` must be the exact bytes received. Read it with `request.text()` and
 * parse only after this returns ok — parsing first and stringifying back
 * produces different bytes and a signature that never matches, which tends to
 * get "fixed" by removing the check.
 */
export function verifyWebhook(
  rawBody: string,
  signatureHeader: string | null,
  now: Date = new Date(),
  secret: string | undefined = process.env.BILLING_WEBHOOK_SECRET,
): VerificationResult {
  if (secret === undefined || secret === "") {
    return {
      ok: false,
      failure: "not-configured",
      reason:
        "BILLING_WEBHOOK_SECRET is not set. Payment confirmations are refused rather than trusted.",
    };
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (parsed === undefined) {
    return {
      ok: false,
      failure: signatureHeader === null ? "missing-signature" : "malformed-signature",
      reason: "The signature header is absent or not in the expected form.",
    };
  }

  const age = Math.abs(Math.floor(now.getTime() / 1000) - parsed.timestamp);
  if (age > TOLERANCE_SECONDS) {
    return {
      ok: false,
      failure: "stale",
      reason: `The delivery is ${age} seconds out of step, beyond the ${TOLERANCE_SECONDS}-second tolerance. A captured delivery must not be replayable.`,
    };
  }

  // The timestamp is inside the signed material, so it cannot be adjusted to
  // make an old body look current.
  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${rawBody}`)
    .digest("hex");

  if (!constantTimeEquals(expected, parsed.signature)) {
    return {
      ok: false,
      failure: "bad-signature",
      reason: "The signature does not match. Nothing in the body is trusted.",
    };
  }

  return { ok: true, reason: "Signature and timestamp verified." };
}

/** Sign a payload the way a provider would. Used by the tests, and only there. */
export function signPayload(rawBody: string, timestamp: number, secret: string): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

/* ------------------------------------------------------------ the events */

/**
 * A payment event, in the shape this platform normalises to.
 *
 * Declared here rather than in the route because two things produce one: the
 * route's own reader for this platform's shape, and the Stripe adapter. One
 * definition means the adapter cannot drift into producing something the route
 * does not read.
 */
export interface BillingEvent {
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
  /** The opportunity being opened, where this payment is a reveal. */
  readonly opportunityId?: string;
  /** The pending charge this confirmation settles, where the provider echoes it. */
  readonly chargeId?: string;
  readonly planId?: string;
  readonly customerCountry?: string;
  readonly customerKind?: CustomerKind;
  readonly periodStart?: string;
  readonly periodEnd?: string;
  /** When the provider raised this, for ordering. */
  readonly occurredAt?: string;
}

/**
 * The events acted on, and only these.
 *
 * An allowlist rather than a switch with a default, so an event type a provider
 * adds later does nothing until somebody decides what it should do. The
 * dangerous direction is a new event being handled by a fall-through that
 * happens to grant something.
 */
export const HANDLED_EVENTS = [
  "payment.succeeded",
  "subscription.trial_started",
  "payment.refunded",
  "payment.disputed",
  "subscription.activated",
  "subscription.renewed",
  "subscription.payment_failed",
  "subscription.canceled",
] as const;

export type BillingEventType = (typeof HANDLED_EVENTS)[number];

export function isHandledEvent(type: string): type is BillingEventType {
  return (HANDLED_EVENTS as readonly string[]).includes(type);
}

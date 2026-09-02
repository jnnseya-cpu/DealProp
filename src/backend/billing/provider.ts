import { randomUUID } from "node:crypto";
import type { PendingCharge } from "@backend/store/schema";
import { savePendingCharge } from "@backend/store/repository";
import { isStripeEndpoint, stripeSessionBody } from "@backend/billing/stripe";

/**
 * Creating a charge with the payment provider.
 *
 * Provider-agnostic on purpose. Every hosted-checkout provider takes the same
 * four things — an amount in minor units, a currency, a description and an
 * idempotency key — and returns somewhere to send the customer. That is the
 * whole contract, and keeping it that small is what stops a provider's naming
 * conventions leaking into the rest of the platform.
 *
 * Three properties matter more than the shape of the payload:
 *
 *  1. **The amount comes from the catalogue**, computed by
 *     `authorisePurchase()` before this is called. Nothing here recomputes it
 *     and nothing accepts it from a request.
 *  2. **The charge is recorded before the provider is called.** If the call
 *     succeeds and the response is lost, the pending charge still exists and
 *     the webhook can be reconciled against it. A charge that exists only in
 *     the provider's records is money we cannot account for.
 *  3. **Idempotency.** The key is sent to the provider and stored here, so a
 *     double-clicked button creates one charge rather than two.
 *
 * Fails closed. Without `BILLING_CHECKOUT_URL` and `BILLING_API_KEY` nothing is
 * charged, and the caller is told plainly rather than being handed a success
 * that did not happen.
 */

export interface ChargeRequest {
  readonly accountId: string;
  readonly description: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly planId?: string;
  readonly packId?: string;
  /** The opportunity being opened, where this is a reveal. */
  readonly opportunityId?: string;
  readonly returnUrl: string;
  /** Where to send somebody who abandons the payment. */
  readonly cancelUrl?: string;
}

export interface ChargeResult {
  readonly ok: boolean;
  readonly charge?: PendingCharge;
  /** Where to send the customer to pay. */
  readonly redirectUrl?: string;
  readonly reason: string;
}

export interface ProviderConfig {
  readonly url: string;
  readonly apiKey: string;
}

export function providerConfig(
  env: Record<string, string | undefined> = process.env,
): ProviderConfig | undefined {
  const url = env.BILLING_CHECKOUT_URL ?? "";
  const apiKey = env.BILLING_API_KEY ?? "";
  if (url === "" || apiKey === "") return undefined;
  return { url, apiKey };
}

export async function createCharge(
  request: ChargeRequest,
  options: { readonly transport?: typeof fetch; readonly config?: ProviderConfig; readonly now?: Date } = {},
): Promise<ChargeResult> {
  const config = options.config ?? providerConfig();
  if (config === undefined) {
    return {
      ok: false,
      reason:
        "No payment provider is connected. Set BILLING_CHECKOUT_URL and BILLING_API_KEY; nothing is charged until both exist, which is the safe state rather than a working one.",
    };
  }

  if (!Number.isSafeInteger(request.amountMinorUnits) || request.amountMinorUnits <= 0) {
    // Defence in depth: the amount already came from the catalogue, and it
    // still does not leave here unchecked.
    return { ok: false, reason: "The amount is not a positive whole number of minor units." };
  }

  const now = options.now ?? new Date();
  const id = randomUUID();
  const idempotencyKey = `charge:${id}`;

  // Recorded before the provider is called. A charge that exists only in the
  // provider's records is money nothing here can account for.
  const pending: PendingCharge = {
    id,
    accountId: request.accountId,
    description: request.description,
    amountMinorUnits: request.amountMinorUnits,
    currency: request.currency,
    ...(request.planId !== undefined ? { planId: request.planId } : {}),
    ...(request.packId !== undefined ? { packId: request.packId } : {}),
    createdAt: now.toISOString(),
    idempotencyKey,
  };
  await savePendingCharge(pending);

  const transport = options.transport ?? fetch;

  // Stripe takes form-encoded line items rather than a JSON amount, which is
  // why it needs an adapter rather than a configuration value. Everything else
  // — the recorded charge, the idempotency key, the amount from the catalogue —
  // is identical either way.
  const stripe = isStripeEndpoint(config.url);
  const metadata: Record<string, string> = {
    chargeId: id,
    accountId: request.accountId,
    ...(request.planId !== undefined ? { planId: request.planId } : {}),
    ...(request.packId !== undefined ? { packId: request.packId } : {}),
    ...(request.opportunityId !== undefined ? { opportunityId: request.opportunityId } : {}),
  };

  try {
    const response = await transport(config.url, {
      method: "POST",
      headers: {
        "content-type": stripe
          ? "application/x-www-form-urlencoded"
          : "application/json",
        authorization: `Bearer ${config.apiKey}`,
        "idempotency-key": idempotencyKey,
      },
      body: stripe
        ? stripeSessionBody({
            amountMinorUnits: request.amountMinorUnits,
            currency: request.currency,
            description: request.description,
            chargeId: id,
            accountId: request.accountId,
            returnUrl: request.returnUrl,
            cancelUrl: request.cancelUrl ?? request.returnUrl,
            metadata,
          }).toString()
        : JSON.stringify({
            reference: id,
            amount: request.amountMinorUnits,
            currency: request.currency,
            description: request.description,
            // So the confirmation can be matched to the charge rather than to a
            // customer, an amount, or anything else that repeats.
            metadata,
            return_url: request.returnUrl,
          }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return { ok: false, charge: pending, reason: `The provider answered ${response.status}.` };
    }

    const body = (await response.json()) as { url?: unknown; redirect_url?: unknown };
    const redirectUrl =
      typeof body.url === "string" ? body.url : typeof body.redirect_url === "string" ? body.redirect_url : undefined;

    if (redirectUrl === undefined) {
      return {
        ok: false,
        charge: pending,
        reason: "The provider did not return somewhere to send the customer.",
      };
    }

    const withRedirect = { ...pending, redirectUrl };
    await savePendingCharge(withRedirect);

    return { ok: true, charge: withRedirect, redirectUrl, reason: "Charge created." };
  } catch (error) {
    // The pending charge stays. If the request actually reached the provider,
    // the webhook will arrive and reconcile against it; if it did not, the
    // charge is unsettled and visible rather than lost.
    return {
      ok: false,
      charge: pending,
      reason: error instanceof Error ? error.message : "The provider could not be reached.",
    };
  }
}

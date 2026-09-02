import { randomUUID } from "node:crypto";
import { CURRENCY } from "@shared/domain/charging";
import {
  decidePayout,
  splitWithProvider,
  type PayoutDecision,
  type PayoutRecipient,
} from "@shared/domain/payouts";
import type { ProviderKind } from "@shared/domain/pricing";
import { authoriseDecision, type Actor } from "@shared/domain/agents";
import { audit } from "@backend/audit";
import { providerConfig } from "@backend/billing/provider";
import { stripeTransferBody, stripeTransferUrl } from "@backend/billing/stripe";
import {
  closePayout,
  getPayoutRecipient,
  listPayouts,
  recordPayout,
  savePayoutRecipient,
} from "@backend/store/repository";
import type { PayoutRecord } from "@backend/store/schema";
import type { Money } from "@shared/money";

/**
 * Sending money out.
 *
 * The most dangerous thing this platform does, and the order of operations is
 * the whole defence:
 *
 *  1. **Decide, purely.** `decidePayout()` answers whether it may go, and it
 *     refuses far more often than it agrees — unverified recipient, hold
 *     period, outstanding reversal, already paid.
 *  2. **Record before sending.** The payout row is written first, with the
 *     idempotency key the store holds unique. If the write loses the race,
 *     nothing is sent. If the transfer then fails, the record stays and is
 *     visible as failed rather than vanishing.
 *  3. **Close afterwards, once.** Settled with the provider's transfer id, or
 *     failed with the reason. Never deleted: a transfer that was attempted
 *     happened, whichever way it went.
 *
 * A named person authorises every one. A payout is somebody deciding to send
 * money, and the shared operator password has nobody behind it to have decided
 * — the same rule that guards an agent sign-off and a manual ledger movement.
 */

export interface PayoutOutcome {
  readonly ok: boolean;
  readonly message: string;
  readonly payout?: PayoutRecord;
}

export async function recordRecipient(
  recipient: PayoutRecipient,
  actor: Actor,
): Promise<PayoutOutcome> {
  const authorisation = authoriseDecision(actor, recipient.verificationEvidence ?? "");
  if (!authorisation.ok) return { ok: false, message: authorisation.reason };
  if (actor.kind !== "account") return { ok: false, message: authorisation.reason };

  const saved = await savePayoutRecipient({
    ...recipient,
    verifiedAt: new Date().toISOString(),
    verifiedBy: actor.name,
  });
  await audit("payout-recipient-recorded", {
    account: { id: actor.id, email: actor.email },
    subject: saved.id,
    detail: `${saved.name} · ${saved.kind} · ${saved.connectedAccountId ?? "no account"}`,
  });

  return { ok: true, message: `${saved.name} recorded as payable, against ${actor.name}.` };
}

export interface PayoutRequest {
  readonly recipientId: string;
  /** What this is a share of — the deal, or the collected payment. */
  readonly sourceReference: string;
  /** What the customer paid, in full. */
  readonly gross: Money;
  readonly providerKind: ProviderKind;
  /** ISO-8601, when that money was collected. */
  readonly collectedAt: string;
  readonly reversalOutstanding: boolean;
  readonly sourceRefunded: boolean;
}

/**
 * What is owed on one engagement, and whether it may go today.
 *
 * The split is computed from the same commission `providerFee()` reads, so the
 * two sides of one number can never disagree. Everything else is read from
 * what is recorded.
 */
export async function assessPayout(
  request: PayoutRequest,
  now: Date = new Date(),
): Promise<{ readonly decision: PayoutDecision; readonly recipient: PayoutRecipient | undefined }> {
  const recipient = await getPayoutRecipient(request.recipientId);
  const split = splitWithProvider(request.gross, request.providerKind);
  const existing = await listPayouts();
  const key = payoutKey(request);

  return {
    recipient,
    decision: decidePayout({
      recipient,
      amount: split.recipient,
      collectedAt: request.collectedAt,
      reversalOutstanding: request.reversalOutstanding,
      sourceRefunded: request.sourceRefunded,
      alreadyPaid: existing.some((p) => p.idempotencyKey === key && p.failedAt === undefined),
      now,
    }),
  };
}

/**
 * The key that makes a payout happen once.
 *
 * Derived from the recipient and what it is a share of, never generated. A
 * fresh random key on every attempt would make the thing being held unique not
 * unique at all — which is the same mistake as generating one per retry on a
 * reveal.
 */
function payoutKey(request: PayoutRequest): string {
  return `payout:${request.recipientId}:${request.sourceReference}`;
}

export async function makePayout(
  request: PayoutRequest,
  actor: Actor,
  options: { readonly transport?: typeof fetch; readonly now?: Date } = {},
): Promise<PayoutOutcome> {
  const note = `${request.providerKind} share of ${request.sourceReference}`;
  const authorisation = authoriseDecision(actor, note);
  if (!authorisation.ok) return { ok: false, message: authorisation.reason };
  if (actor.kind !== "account") return { ok: false, message: authorisation.reason };

  const now = options.now ?? new Date();
  const { decision, recipient } = await assessPayout(request, now);
  if (!decision.payable || recipient === undefined) {
    return { ok: false, message: decision.blockers.map((b) => b.reason).join(" ") };
  }

  const split = splitWithProvider(request.gross, request.providerKind);
  const record: PayoutRecord = {
    id: randomUUID(),
    recipientId: recipient.id,
    sourceReference: request.sourceReference,
    amount: split.recipient,
    currency: CURRENCY,
    gross: request.gross,
    basis: split.basis,
    collectedAt: request.collectedAt,
    createdAt: now.toISOString(),
    authorisedBy: actor.name,
    idempotencyKey: payoutKey(request),
  };

  // Written before the provider is called. If this loses the race, nothing is
  // sent — which is the outcome that matters, because a duplicate payment out
  // is gone.
  const written = await recordPayout(record);
  if (!written) {
    return { ok: false, message: "That share has already been paid. Nothing was sent again." };
  }

  const config = providerConfig();
  const url = config === undefined ? "" : stripeTransferUrl(config.url);
  if (config === undefined || url === "") {
    await closePayout(record.id, {
      failedAt: now.toISOString(),
      failureReason:
        "No payment provider is connected, so nothing was sent. The payout is recorded as failed and may be retried once one is.",
    });
    return {
      ok: false,
      payout: record,
      message:
        "No payment provider is connected. The payout is recorded as failed rather than as sent, which is the safe state.",
    };
  }

  const transport = options.transport ?? fetch;
  try {
    const response = await transport(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Bearer ${config.apiKey}`,
        // The provider's own idempotency, in addition to ours. Two layers
        // because they protect different things: ours stops a second decision
        // to pay, theirs stops a retried request becoming a second transfer.
        "idempotency-key": record.idempotencyKey,
      },
      body: stripeTransferBody({
        amountMinorUnits: record.amount,
        currency: record.currency,
        destination: recipient.connectedAccountId ?? "",
        sourceReference: record.sourceReference,
        description: record.basis,
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      await closePayout(record.id, {
        failedAt: new Date().toISOString(),
        failureReason: `The provider answered ${response.status}.`,
      });
      return { ok: false, payout: record, message: `The provider refused it (${response.status}).` };
    }

    const body = (await response.json()) as { id?: unknown };
    const transferReference = typeof body.id === "string" ? body.id : record.id;
    await closePayout(record.id, { settledAt: new Date().toISOString(), transferReference });

    await audit("payout-made", {
      account: { id: actor.id, email: actor.email },
      subject: record.sourceReference,
      detail: `${recipient.name} · ${record.amount} pence · ${transferReference}`,
    });

    return {
      ok: true,
      payout: record,
      message: `Sent to ${recipient.name}, against ${actor.name}.`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The provider could not be reached.";
    // The record stays and is closed as failed. A payout that exists only in
    // the provider's records is money nothing here can account for, and in
    // this direction it has already left.
    await closePayout(record.id, { failedAt: new Date().toISOString(), failureReason: reason });
    await audit("payout-failed", {
      account: { id: actor.id, email: actor.email },
      subject: record.sourceReference,
      detail: reason,
    });
    return { ok: false, payout: record, message: reason };
  }
}

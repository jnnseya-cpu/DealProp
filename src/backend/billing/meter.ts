import { randomUUID } from "node:crypto";
import type { Account } from "@shared/domain/accounts";
import { entitlementsFor, type Entitlements } from "@shared/domain/entitlements";
import { operationPrice, type MeteredOperation } from "@shared/domain/pricing";
import { standing } from "@shared/domain/ledger";
import {
  getSubscription,
  listCreditLots,
  listLedgerEntries,
  recordAllowanceUse,
  spendCredits,
} from "@backend/store/repository";
import { entitlementsForAccount } from "@backend/billing/entitlement";

/**
 * Charging for something as it is used.
 *
 * Two things have to be true at once for a metered product to make money, and
 * missing either is the same loss:
 *
 *  - **What the plan includes has to run out.** A plan that says twenty
 *    memoranda and never counts them sells one month of the cheapest plan that
 *    includes them in exchange for the whole library. The customer then cancels
 *    and the value has left permanently.
 *  - **Going past what is included has to cost something.** Refusing outright
 *    is the safe answer and the wrong one: it caps revenue at the plan price
 *    and pushes the heaviest, most valuable users away. Charging the prepaid
 *    balance turns the overflow into revenue instead.
 *
 * So the order is: is it already paid for, then is it included, then can it be
 * charged, then no. Nothing runs until one of those says yes.
 *
 * Staff are not metered. A limit on the people running the platform protects
 * nobody and would stop the pipeline working.
 */

export type MeterOutcome =
  /** Included in the plan, and counted against it. */
  | "allowance"
  /** Past what the plan includes, and paid for from the prepaid balance. */
  | "charged"
  /** Already paid for in this period. Reopening something is free. */
  | "already-paid"
  /** Staff, who are not customers. */
  | "not-metered"
  /** Nothing was charged and nothing may run. */
  | "refused";

export interface MeterDecision {
  readonly allowed: boolean;
  readonly outcome: MeterOutcome;
  /** Always populated, allowed or not. Shown to the person who asked. */
  readonly reason: string;
  readonly entitlements: Entitlements;
}

/**
 * Staff, narrowed for the type system as well as for the reader.
 *
 * A type predicate rather than a boolean, so the compiler knows the account is
 * present after the check. The alternative is a non-null assertion, and this
 * codebase does not carry those.
 */
function isCustomer(
  account: Pick<Account, "id" | "role"> | undefined,
): account is Pick<Account, "id" | "role"> {
  if (account === undefined) return false;
  return account.role !== "admin" && account.role !== "operator";
}

/**
 * Meter one use of one item.
 *
 * `itemId` makes the charge specific: a memorandum for deal A and one for deal
 * B are two uses, and opening deal A twice in a period is one. That is what a
 * customer expects, and a cap that charges twice for the same document is a
 * support ticket and a refund rather than revenue.
 */
export async function meter(
  account: Pick<Account, "id" | "role"> | undefined,
  operation: MeteredOperation,
  itemId: string,
  now: Date = new Date(),
): Promise<MeterDecision> {
  const entitlements = await entitlementsForAccount(account);

  if (!isCustomer(account)) {
    return {
      allowed: true,
      outcome: "not-metered",
      reason: "Staff access is not metered.",
      entitlements,
    };
  }
  const accountId = account.id;

  const subscription = await getSubscription(accountId);
  const periodStart = subscription?.currentPeriodStart ?? startOfMonth(now);
  const at = now.toISOString();
  const key = `${operation}:${accountId}:${itemId}:${periodStart}`;

  // Anything already reversed blocks everything. Somebody who took the money
  // back after using the service does not carry on using it.
  const [lots, entries] = await Promise.all([listCreditLots(accountId), listLedgerEntries(accountId)]);
  const position = standing(lots, entries, now);
  if (!position.maySpend) {
    return { allowed: false, outcome: "refused", reason: position.reason, entitlements };
  }

  const allowance = await recordAllowanceUse({
    accountId,
    idempotencyKey: key,
    at,
    periodStart,
    limit: entitlements.memorandaPerPeriod,
    entryId: randomUUID(),
    reference: itemId,
    reason: `${operation} for ${itemId}`,
  });

  if (allowance.duplicate) {
    return {
      allowed: true,
      outcome: "already-paid",
      reason: "Already open to you this period.",
      entitlements,
    };
  }
  if (allowance.allowed) {
    return {
      allowed: true,
      outcome: "allowance",
      reason: allowance.reason,
      entitlements,
    };
  }

  // Past what the plan includes. Charge rather than refuse — but only where the
  // plan grants any at all, because a plan that includes none of something is
  // not a plan somebody may buy their way past one item at a time.
  if (entitlements.memorandaPerPeriod === 0 || !entitlements.mayExtractValue) {
    return {
      allowed: false,
      outcome: "refused",
      reason: `${allowance.reason} ${entitlements.reason}`,
      entitlements,
    };
  }

  const price = operationPrice(operation);
  const spend = await spendCredits({
    accountId,
    // The same key as the allowance attempt, so a retry of a charged operation
    // cannot be charged a second time.
    idempotencyKey: key,
    at,
    amount: price,
    entryIdPrefix: randomUUID(),
    reference: itemId,
    reason: `${operation} beyond the ${allowance.limit} included this period`,
  });

  if (!spend.ok) {
    return {
      allowed: false,
      outcome: "refused",
      reason: `${allowance.reason} Going further costs £${(price / 100).toFixed(2)} from your balance, and ${spend.reason.toLowerCase()}`,
      entitlements,
    };
  }

  return {
    allowed: true,
    outcome: spend.duplicate ? "already-paid" : "charged",
    reason: `£${(price / 100).toFixed(2)} charged from your balance, beyond the ${allowance.limit} included this period.`,
    entitlements,
  };
}

/**
 * The period an account with no subscription is measured over.
 *
 * A calendar month, so a free or lapsed account still has a bounded window
 * rather than an unbounded one. Without this the limit would be measured from
 * the epoch, which for a limit of zero makes no difference and for anything
 * else would be a lifetime allowance.
 */
function startOfMonth(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

import { ZERO, type Money } from "@shared/money";
import {
  FREE_PLAN_ID,
  plan,
  type PlanId,
  type PlanLimits,
} from "@shared/domain/pricing";

/**
 * What a paying account may actually do, and when that stops.
 *
 * A subscription platform loses money in the gap between "stopped paying" and
 * "stopped receiving", and that gap is made of small omissions: a cancellation
 * that leaves the flag on, a failed payment that nothing acts on, a trial that
 * grants everything, a downgrade whose new limits are never applied to what was
 * created under the old ones. Each of those is answered explicitly here.
 *
 * One rule underpins the rest: **entitlement is derived, never stored**. There
 * is no `isPro` column that a stale write can leave true. The plan, the status
 * and the dates are the facts; what somebody may do is computed from them every
 * time it is asked, against a date that is passed in.
 */

export type SubscriptionStatus =
  /** Inside a free trial. Access, minus the parts worth stealing. */
  | "trialing"
  /** Paid and current. */
  | "active"
  /** A payment failed. Access continues, value extraction does not. */
  | "past-due"
  /** Recovery gave up. Free plan only. */
  | "unpaid"
  /** Cancelled. Paid access runs to the end of the period already bought. */
  | "canceled"
  /** Suspended by us, immediately and without a paid-up grace period. */
  | "blocked";

export interface ImmediateSupplyConsent {
  readonly at: string;
  /** The exact wording agreed, kept as the evidence. */
  readonly statement: string;
}

export interface Subscription {
  readonly id: string;
  readonly accountId: string;
  readonly planId: PlanId;
  readonly status: SubscriptionStatus;
  /** ISO-8601. The period the customer has paid for. */
  readonly currentPeriodStart: string;
  readonly currentPeriodEnd: string;
  readonly trialEndsAt?: string;
  /** When a payment first failed, for measuring the grace window. */
  readonly delinquentSince?: string;
  readonly canceledAt?: string;
  readonly blockedReason?: string;
  /** Whether the consumer agreed to supply starting before the cooling-off period ends. */
  readonly immediateSupplyConsent?: ImmediateSupplyConsent;
  /** The provider's ids, so a webhook can find this record. */
  readonly providerCustomerId?: string;
  readonly providerSubscriptionId?: string;
  /**
   * When the provider event that last changed this record was raised.
   *
   * Webhooks arrive out of order. Without this, a late `updated` event
   * reinstates a subscription that a `deleted` event already ended — the
   * customer stops paying and the access comes back on its own.
   */
  readonly lastEventAt?: string;
  readonly lastEventId?: string;
}

/**
 * How long access survives a failed payment.
 *
 * Long enough for an expired card to be replaced, short enough that it is not a
 * free month. The window is what the customer keeps; what they lose on day one
 * of it is the ability to take anything new out of the platform.
 */
export const DUNNING_GRACE_DAYS = 7;

export interface Entitlements extends PlanLimits {
  readonly planId: PlanId;
  /** The plan being billed, which is not always the plan in force. */
  readonly billedPlanId: PlanId;
  readonly status: SubscriptionStatus;
  /** False where the account may look but not take anything new out. */
  readonly mayExtractValue: boolean;
  readonly reason: string;
}

const FREE_LIMITS = (): PlanLimits => {
  const free = plan(FREE_PLAN_ID);
  if (free === undefined) throw new Error("The free plan is missing from the catalogue");
  return free.limits;
};

/**
 * Trial limits.
 *
 * A trial exists to show what the platform does, not to deliver a month of it
 * for nothing. Everything is unlocked except the two things whose whole value
 * transfers on first use: memoranda, and a balance of credits. A trial that
 * grants those is a trial somebody takes once per email address.
 */
function trialLimits(limits: PlanLimits): PlanLimits {
  return {
    ...limits,
    memorandaPerPeriod: Math.min(limits.memorandaPerPeriod, 1),
    periodCredits: ZERO,
  };
}

/**
 * What a failed payment leaves behind.
 *
 * The grace window keeps the account usable so a genuine card problem is not
 * punished — but nothing new comes out of it. No memoranda, no credit
 * allowance, no new mandates. Recovering a lapsed card is worth a week of read
 * access; it is not worth another month of the product.
 */
function graceLimits(limits: PlanLimits): PlanLimits {
  return {
    ...limits,
    memorandaPerPeriod: 0,
    periodCredits: ZERO,
    maxBuyBoxes: typeof limits.maxBuyBoxes === "number" ? limits.maxBuyBoxes : "unlimited",
    maxFundingBoxes:
      typeof limits.maxFundingBoxes === "number" ? limits.maxFundingBoxes : "unlimited",
  };
}

function daysBetween(fromIso: string, now: Date): number {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return Number.POSITIVE_INFINITY;
  return (now.getTime() - from.getTime()) / 86_400_000;
}

function isAfter(iso: string | undefined, now: Date): boolean {
  if (iso === undefined) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() > now.getTime();
}

/**
 * The single place the question "what may this account do" is answered.
 *
 * No account, no subscription and an unrecognised plan all land on the free
 * plan rather than on an error or on everything — the safe direction is the one
 * where a bug costs a customer some access, not the one where it gives the
 * product away.
 */
export function entitlementsFor(
  subscription: Subscription | undefined,
  now: Date = new Date(),
): Entitlements {
  const free = FREE_LIMITS();

  if (subscription === undefined) {
    return {
      ...free,
      planId: FREE_PLAN_ID,
      billedPlanId: FREE_PLAN_ID,
      status: "unpaid",
      mayExtractValue: false,
      reason: "No subscription. The free plan applies.",
    };
  }

  const paid = plan(subscription.planId);
  if (paid === undefined) {
    // A plan that was withdrawn from the catalogue. Falling back to the free
    // plan is the only honest answer; falling back to the last known limits
    // would keep selling something that no longer exists.
    return {
      ...free,
      planId: FREE_PLAN_ID,
      billedPlanId: FREE_PLAN_ID,
      status: subscription.status,
      mayExtractValue: false,
      reason: `Plan ${subscription.planId} is no longer in the catalogue, so the free plan applies. Move this account onto a current plan.`,
    };
  }

  const billed = paid.id;

  switch (subscription.status) {
    case "blocked":
      return {
        ...free,
        planId: FREE_PLAN_ID,
        billedPlanId: billed,
        status: "blocked",
        mayExtractValue: false,
        reason:
          subscription.blockedReason ??
          "This account is suspended. Paid access does not continue through a suspension, whatever the period dates say.",
      };

    case "unpaid":
      return {
        ...free,
        planId: FREE_PLAN_ID,
        billedPlanId: billed,
        status: "unpaid",
        mayExtractValue: false,
        reason: "Payment was not recovered, so the free plan applies.",
      };

    case "canceled": {
      // Cancelling does not take back what was already paid for. Access runs to
      // the end of the bought period and then stops on its own — which is the
      // half that gets forgotten, so it is derived from the date rather than
      // waiting for a job to run.
      if (isAfter(subscription.currentPeriodEnd, now)) {
        return {
          ...paid.limits,
          planId: billed,
          billedPlanId: billed,
          status: "canceled",
          mayExtractValue: true,
          reason: `Cancelled, and the period already paid for runs until ${subscription.currentPeriodEnd.slice(0, 10)}.`,
        };
      }
      return {
        ...free,
        planId: FREE_PLAN_ID,
        billedPlanId: billed,
        status: "canceled",
        mayExtractValue: false,
        reason: "Cancelled, and the paid period has ended.",
      };
    }

    case "past-due": {
      const elapsed = daysBetween(subscription.delinquentSince ?? subscription.currentPeriodEnd, now);
      if (elapsed >= DUNNING_GRACE_DAYS) {
        return {
          ...free,
          planId: FREE_PLAN_ID,
          billedPlanId: billed,
          status: "past-due",
          mayExtractValue: false,
          reason: `A payment has been outstanding for ${Math.floor(elapsed)} days, beyond the ${DUNNING_GRACE_DAYS}-day grace window. The free plan applies until it is settled.`,
        };
      }
      return {
        ...graceLimits(paid.limits),
        planId: billed,
        billedPlanId: billed,
        status: "past-due",
        mayExtractValue: false,
        reason: `A payment failed. Existing access continues for ${DUNNING_GRACE_DAYS} days while the card is updated, but nothing new can be taken out in the meantime.`,
      };
    }

    case "trialing": {
      if (!isAfter(subscription.trialEndsAt, now)) {
        return {
          ...free,
          planId: FREE_PLAN_ID,
          billedPlanId: billed,
          status: "trialing",
          mayExtractValue: false,
          reason: "The trial has ended and no payment has been taken. The free plan applies.",
        };
      }
      return {
        ...trialLimits(paid.limits),
        planId: billed,
        billedPlanId: billed,
        status: "trialing",
        mayExtractValue: true,
        reason: `Trial until ${(subscription.trialEndsAt ?? "").slice(0, 10)}. Memoranda and credit allowances start when the first payment does.`,
      };
    }

    case "active": {
      if (!isAfter(subscription.currentPeriodEnd, now)) {
        // The period lapsed and no renewal event arrived. Something upstream
        // failed, and the safe reading of "paid until yesterday" is "not paid".
        return {
          ...free,
          planId: FREE_PLAN_ID,
          billedPlanId: billed,
          status: "active",
          mayExtractValue: false,
          reason: `The paid period ended on ${subscription.currentPeriodEnd.slice(0, 10)} and no renewal has been recorded. Access is on the free plan until it is.`,
        };
      }
      return {
        ...paid.limits,
        planId: billed,
        billedPlanId: billed,
        status: "active",
        mayExtractValue: true,
        reason: `${paid.name}, paid until ${subscription.currentPeriodEnd.slice(0, 10)}.`,
      };
    }
  }
}

/* ------------------------------------------------------------- the limits */

export interface LimitDecision {
  readonly allowed: boolean;
  readonly limit: number | "unlimited";
  readonly current: number;
  readonly reason: string;
}

/** Whether one more of something may be created. */
export function withinLimit(
  current: number,
  limit: number | "unlimited",
  what: string,
): LimitDecision {
  if (limit === "unlimited") {
    return { allowed: true, limit, current, reason: `Unlimited ${what} on this plan.` };
  }
  if (current < limit) {
    return {
      allowed: true,
      limit,
      current,
      reason: `${current} of ${limit} ${what} used.`,
    };
  }
  return {
    allowed: false,
    limit,
    current,
    reason:
      limit === 0
        ? `${what} are not included on this plan.`
        : `This plan includes ${limit} ${what} and ${current} are in use. Remove one or move up a plan.`,
  };
}

/**
 * Which existing records a downgraded plan still covers.
 *
 * A downgrade is the leak nobody notices: somebody creates ten mandates on the
 * top plan, drops to the one that includes three, and keeps all ten because the
 * limit is only ever checked when creating. Records are never deleted — that
 * would be destroying a customer's work over a billing change — but everything
 * past the limit stops counting, oldest kept, deterministically.
 *
 * This matters beyond billing: mandates feed the count of interested buyers
 * shown to sellers, so an unenforced limit is also an overstatement made to a
 * member of the public.
 */
export function withinPlan<T extends { readonly id: string; readonly createdAt?: string }>(
  items: readonly T[],
  limit: number | "unlimited",
): { readonly covered: readonly T[]; readonly excess: readonly T[] } {
  if (limit === "unlimited") return { covered: items, excess: [] };

  const ordered = [...items].sort((a, b) =>
    (a.createdAt ?? a.id).localeCompare(b.createdAt ?? b.id),
  );
  return { covered: ordered.slice(0, limit), excess: ordered.slice(limit) };
}

/* ----------------------------------------------------- consumer contracts */

export interface CoolingOff {
  readonly withinPeriod: boolean;
  /** What must be refunded if the customer cancels right now. */
  readonly refundDue: "full" | "pro-rata" | "none";
  readonly reason: string;
}

/**
 * The Consumer Contracts Regulations 2013 cancellation right.
 *
 * Fourteen days from the contract, for a consumer buying at a distance. The
 * part that costs money is the default: without the customer's express
 * agreement to start immediately *and* their acknowledgement that this ends the
 * cancellation right, a consumer can use the service for thirteen days and
 * still be owed the whole fee back. With that agreement, only what has actually
 * been supplied is chargeable.
 *
 * So the consent is not a checkbox for tidiness. It is the difference between
 * charging pro rata and refunding in full, on every cancellation in the first
 * fortnight.
 */
export const COOLING_OFF_DAYS = 14;

export function coolingOff(
  subscription: Pick<Subscription, "currentPeriodStart" | "immediateSupplyConsent">,
  customerKind: "consumer" | "business",
  now: Date = new Date(),
): CoolingOff {
  if (customerKind === "business") {
    return {
      withinPeriod: false,
      refundDue: "none",
      reason: "The statutory cancellation right applies to consumers, not to businesses.",
    };
  }

  const elapsed = daysBetween(subscription.currentPeriodStart, now);
  if (elapsed >= COOLING_OFF_DAYS) {
    return {
      withinPeriod: false,
      refundDue: "none",
      reason: `${Math.floor(elapsed)} days since the contract, beyond the ${COOLING_OFF_DAYS}-day cancellation period.`,
    };
  }

  if (subscription.immediateSupplyConsent === undefined) {
    return {
      withinPeriod: true,
      refundDue: "full",
      reason: `Within the ${COOLING_OFF_DAYS}-day cancellation period and no record that the customer agreed to supply beginning immediately. The full fee is refundable however much has been used.`,
    };
  }

  return {
    withinPeriod: true,
    refundDue: "pro-rata",
    reason: `Within the cancellation period, but the customer agreed on ${subscription.immediateSupplyConsent.at.slice(0, 10)} to supply beginning at once and acknowledged losing the right to cancel. Only the unsupplied part is refundable.`,
  };
}

/** Balance granted at the start of a paid period, if any. */
export function periodAllowance(entitlements: Entitlements): Money {
  return entitlements.mayExtractValue ? entitlements.periodCredits : ZERO;
}

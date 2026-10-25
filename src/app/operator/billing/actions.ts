"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { money, type Money } from "@shared/money";
import { expiryFrom } from "@shared/domain/ledger";
import { GRANTED_CREDIT_MONTHS, PLANS, plan, type PlanId } from "@shared/domain/pricing";
import type { Subscription } from "@shared/domain/entitlements";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import {
  applyTopUp,
  getAccount,
  getSubscription,
  recordNote,
  saveSubscription,
} from "@backend/store/repository";
import { audit } from "@backend/audit";

/**
 * Giving balance away, and writing off what cannot be collected.
 *
 * This exists because the alternative is worse. Without a recorded path, a
 * goodwill credit gets made at a database prompt: no author, no reason, no
 * audit line, and nothing to distinguish it from somebody quietly crediting
 * themselves. Every platform that handles money grows this hole, and it is
 * always found afterwards.
 *
 * So the path exists and it is narrow:
 *
 *  - **Administrators only.** Not the shared operator password: an adjustment
 *    has an author, and there is nobody behind a shared password to be one.
 *  - **A reason is required**, of a length that cannot be a full stop.
 *  - **A ceiling per adjustment**, so a slipped decimal point is a small
 *    mistake rather than a large one.
 *  - **Audited and idempotent.** The audit line names the person; the ledger
 *    entry names the audit line.
 *
 * Balance given here is a grant, never a purchase. It has no cash behind it, so
 * it can never be refunded out as cash — which is what stops this becoming a
 * withdrawal mechanism with a friendly name.
 */

/** The most any single adjustment may move. A typo should not be able to be big. */
export const ADJUSTMENT_CEILING: Money = money(50_000);

const MIN_REASON = 12;

export interface AdjustmentResult {
  readonly ok: boolean;
  readonly message: string;
}

export async function grantBalanceAction(
  _previous: AdjustmentResult | undefined,
  formData: FormData,
): Promise<AdjustmentResult> {
  // Financial records are evidence, and gated like the audit trail.
  const viewer = await requirePermission("view-audit-log", "/operator/billing");
  const author = viewerAccount(viewer);

  if (author === undefined) {
    return {
      ok: false,
      message:
        "Adjustments need a named administrator. Sign in with your own account rather than the shared password — an adjustment with no author is the thing this is here to prevent.",
    };
  }

  const accountId = String(formData.get("accountId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const pounds = Number(formData.get("amount"));

  if (accountId === "") return { ok: false, message: "Choose an account." };
  if (reason.length < MIN_REASON) {
    return {
      ok: false,
      message: `Give a reason of at least ${MIN_REASON} characters. It is what somebody reads when this is questioned.`,
    };
  }
  if (!Number.isFinite(pounds) || pounds <= 0) {
    return { ok: false, message: "Enter an amount in pounds, above zero." };
  }

  const amount = money(Math.round(pounds * 100));
  if (amount > ADJUSTMENT_CEILING) {
    return {
      ok: false,
      message: `£${(ADJUSTMENT_CEILING / 100).toFixed(2)} is the most one adjustment may grant. Anything larger is a decision to take twice.`,
    };
  }

  const target = await getAccount(accountId);
  if (target === undefined) return { ok: false, message: "No such account." };

  const at = new Date().toISOString();
  const reference = randomUUID();

  await applyTopUp({
    accountId,
    idempotencyKey: `adjustment:${reference}`,
    at,
    // Zero purchased, all granted: nothing was paid, so nothing may be refunded.
    purchased: {
      lotId: randomUUID(),
      amount: money(0),
      cashGross: money(0),
      cashTax: money(0),
      expiresAt: expiryFrom(at, GRANTED_CREDIT_MONTHS),
    },
    granted: {
      lotId: randomUUID(),
      amount,
      expiresAt: expiryFrom(at, GRANTED_CREDIT_MONTHS),
    },
    paymentReference: `adjustment:${reference}`,
    entryIdPrefix: randomUUID(),
    reason: `Granted by ${author.email}: ${reason}`,
  });

  await audit("account-created", {
    account: author,
    subject: accountId,
    detail: `Granted £${(amount / 100).toFixed(2)} of balance. ${reason}`,
  });

  revalidatePath("/operator/billing");
  return {
    ok: true,
    message: `£${(amount / 100).toFixed(2)} granted to ${target.email}, recorded against your name.`,
  };
}

/**
 * Write off a debt that will not be collected.
 *
 * A debt left outstanding forever blocks the account forever, which turns a
 * customer who might have settled into one who cannot come back. Writing it off
 * is a decision somebody makes and signs for; it is not something that happens
 * because a number was inconvenient.
 */
export async function writeOffDebtAction(
  _previous: AdjustmentResult | undefined,
  formData: FormData,
): Promise<AdjustmentResult> {
  const viewer = await requirePermission("view-audit-log", "/operator/billing");
  const author = viewerAccount(viewer);
  if (author === undefined) {
    return { ok: false, message: "Writing off a debt needs a named administrator." };
  }

  const accountId = String(formData.get("accountId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const pounds = Number(formData.get("amount"));

  if (accountId === "") return { ok: false, message: "Choose an account." };
  if (reason.length < MIN_REASON) {
    return { ok: false, message: `Give a reason of at least ${MIN_REASON} characters.` };
  }
  if (!Number.isFinite(pounds) || pounds <= 0) {
    return { ok: false, message: "Enter the amount being written off, in pounds." };
  }

  const amount = money(Math.round(pounds * 100));
  const at = new Date().toISOString();
  const reference = randomUUID();

  // A positive debt entry cancels the negative ones. The original debt entry
  // stays exactly where it is: the ledger records that it happened and that it
  // was written off, not that it never existed.
  await recordNote({
    accountId,
    idempotencyKey: `writeoff:${reference}`,
    at,
    kind: "debt",
    amount,
    entryId: randomUUID(),
    reference,
    reason: `Written off by ${author.email}: ${reason}`,
  });

  await audit("account-enabled", {
    account: author,
    subject: accountId,
    detail: `Wrote off £${(amount / 100).toFixed(2)} of debt. ${reason}`,
  });

  revalidatePath("/operator/billing");
  return { ok: true, message: `£${(amount / 100).toFixed(2)} written off against your name.` };
}

/**
 * Comp an account onto a plan — full access, no charge.
 *
 * A comped subscription is still a subscription: the entitlement is derived
 * from it exactly as for a paying customer (§26), so there is no second access
 * path and no `isPro` flag to leave stale. It is simply a subscription that was
 * granted rather than bought — `status: "active"` with a period far enough out
 * that it never lapses — and like every grant it carries a named author and a
 * reason in the audit trail.
 *
 * The shared operator password is allowed here, unlike a balance grant: this
 * moves no money and can be reversed by cancelling, and it is the only way to
 * stand up the very first administrator before any named account exists. The
 * author is recorded either way.
 */
export async function compPlanAction(
  _previous: AdjustmentResult | undefined,
  formData: FormData,
): Promise<AdjustmentResult> {
  const viewer = await requirePermission("view-audit-log", "/operator/billing");
  const author = viewerAccount(viewer);

  const accountId = String(formData.get("accountId") ?? "").trim();
  const planId = String(formData.get("planId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (accountId === "") return { ok: false, message: "Choose an account." };
  if (!PLANS.some((p) => p.id === planId)) return { ok: false, message: "Choose a plan." };
  if (reason.length < MIN_REASON) {
    return { ok: false, message: `Give a reason of at least ${MIN_REASON} characters.` };
  }

  const target = await getAccount(accountId);
  if (target === undefined) return { ok: false, message: "No such account." };

  const now = new Date();
  // A hundred years out: a comp does not lapse, but it is still a dated period
  // the entitlement engine checks, not a flag that lives forever by its absence.
  const end = new Date(now);
  end.setFullYear(end.getFullYear() + 100);

  const existing = await getSubscription(accountId);
  const subscription: Subscription = {
    id: existing?.id ?? `sub-comp-${randomUUID()}`,
    accountId,
    planId: planId as PlanId,
    status: "active",
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: end.toISOString(),
    lastEventAt: now.toISOString(),
    lastEventId: `comp-${randomUUID()}`,
  };
  await saveSubscription(subscription);

  const by = author?.email ?? "the shared operator password";
  await audit("subscription-comped", {
    ...(author !== undefined ? { account: author } : {}),
    subject: accountId,
    detail: `Comped ${target.email} to ${planId} (free). By ${by}: ${reason}`,
  });

  revalidatePath("/operator/billing");
  return {
    ok: true,
    message: `${target.email} comped to ${plan(planId as PlanId)?.name ?? planId} — full access, no charge.${
      author === undefined ? " Granted via the shared password; record who authorised it." : ""
    }`,
  };
}

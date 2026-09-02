"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { makePayout, recordRecipient, type PayoutOutcome } from "@backend/billing/payouts";
import { savePayoutRecipient } from "@backend/store/repository";
import { fromMajor } from "@shared/money";
import type { Actor } from "@shared/domain/agents";
import type { RecipientKind } from "@shared/domain/payouts";
import { PROVIDER_COMMISSIONS, type ProviderKind } from "@shared/domain/pricing";

/**
 * Recording who may be paid, and paying them.
 *
 * Every one of these is somebody deciding to send money, so every one takes a
 * named actor and the shared operator password is refused. That is the same
 * rule as a manual ledger movement and an agent sign-off, and it matters more
 * here: a wrong payment in can be refunded, a wrong payment out is gone.
 *
 * No action takes an amount. A payout names the recipient, what it is a share
 * of, and what the customer paid; the split comes from the commission
 * catalogue on the server.
 */

export interface ActionResult {
  readonly ok: boolean;
  readonly message: string;
}

const KINDS: readonly RecipientKind[] = ["estate-agent", "provider", "introducer"];

function isKind(value: string): value is RecipientKind {
  return KINDS.includes(value as RecipientKind);
}

function isProviderKind(value: string): value is ProviderKind {
  return PROVIDER_COMMISSIONS.some((c) => c.kind === value);
}

async function actorFor(): Promise<Actor> {
  const viewer = await requirePermission("view-audit-log", "/operator/payouts");
  const account = viewerAccount(viewer);
  return account === undefined
    ? { kind: "shared-operator" }
    : { kind: "account", id: account.id, name: account.name, email: account.email };
}

export async function recordRecipientAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "").trim();
  const connectedAccountId = String(formData.get("connectedAccountId") ?? "").trim();
  const evidence = String(formData.get("evidence") ?? "").trim();

  if (!isKind(kind)) return { ok: false, message: "No such kind of recipient." };
  if (name === "" || connectedAccountId === "") {
    return { ok: false, message: "Name them, and give the account the money goes to." };
  }

  const actor = await actorFor();
  const result: PayoutOutcome = await recordRecipient(
    {
      id: String(formData.get("id") ?? "").trim() || randomUUID(),
      name,
      kind,
      connectedAccountId,
      verificationEvidence: evidence,
    },
    actor,
  );
  if (result.ok) revalidatePath("/operator/payouts");
  return { ok: result.ok, message: result.message };
}

export async function suspendRecipientAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason === "") return { ok: false, message: "Say why. A suspension with no reason is a mystery to whoever finds it." };

  const viewer = await requirePermission("view-audit-log", "/operator/payouts");
  const account = viewerAccount(viewer);
  if (account === undefined) {
    return { ok: false, message: "Stopping payouts is a decision. Sign in with your own account." };
  }

  const { getPayoutRecipient } = await import("@backend/store/repository");
  const recipient = await getPayoutRecipient(id);
  if (recipient === undefined) return { ok: false, message: "No such recipient." };

  await savePayoutRecipient({
    ...recipient,
    suspendedAt: new Date().toISOString(),
    suspendedReason: `${reason} (${account.name})`,
  });
  revalidatePath("/operator/payouts");
  return { ok: true, message: `Payouts to ${recipient.name} are stopped, against ${account.name}.` };
}

export async function makePayoutAction(
  _previous: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const recipientId = String(formData.get("recipientId") ?? "").trim();
  const sourceReference = String(formData.get("sourceReference") ?? "").trim();
  const providerKind = String(formData.get("providerKind") ?? "").trim();
  const collectedAt = String(formData.get("collectedAt") ?? "").trim();
  const grossMajor = Number(String(formData.get("gross") ?? "").replace(/[,\s£]/g, ""));

  if (!isProviderKind(providerKind)) return { ok: false, message: "No such kind of engagement." };
  if (sourceReference === "") return { ok: false, message: "Say what this is a share of." };
  if (!Number.isFinite(grossMajor) || grossMajor <= 0) {
    return { ok: false, message: "The payment has to be a positive figure." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(collectedAt)) {
    return { ok: false, message: "Give the date the money was collected — the hold is measured from it." };
  }

  const actor = await actorFor();
  const result = await makePayout(
    {
      recipientId,
      sourceReference,
      gross: fromMajor(grossMajor),
      providerKind,
      collectedAt: new Date(`${collectedAt}T00:00:00.000Z`).toISOString(),
      // Read from the operator rather than inferred, because the platform does
      // not yet reconcile against the provider's dispute list. Stated as a
      // question so the answer is somebody's rather than a default.
      reversalOutstanding: formData.get("reversalOutstanding") === "on",
      sourceRefunded: formData.get("sourceRefunded") === "on",
    },
    actor,
  );
  if (result.ok) revalidatePath("/operator/payouts");
  return { ok: result.ok, message: result.message };
}

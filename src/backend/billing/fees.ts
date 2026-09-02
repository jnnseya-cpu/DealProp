import { randomUUID } from "node:crypto";
import { appraise } from "@shared/domain/economics";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import {
  feeDefinition,
  feePosition,
  type FeeDisclosure,
  type FeeKey,
  type FeePosition,
} from "@shared/domain/fees";
import { authoriseDecision, type Actor } from "@shared/domain/agents";
import { permissionsHeld } from "@backend/permissions";
import { audit } from "@backend/audit";
import {
  getDeal,
  listDealFees,
  raiseDealFee,
  saveDeal,
  voidDealFee,
} from "@backend/store/repository";
import type { DealFee, DealRecord } from "@backend/store/schema";

/**
 * Raising a fee against a deal.
 *
 * The narrow path between the model and the money. Everything that decides
 * *whether* is in `fees.ts` and is pure; this assembles the facts, checks who
 * is asking, and writes once.
 *
 * Two rules carried over from the ledger, because a fee is money:
 *
 *  - **A named person, never the shared operator password.** An invoice is
 *    somebody's statement that work was done and is owed for. A shared
 *    credential has nobody behind it to have made it, and the same
 *    `authoriseDecision()` that guards an agent sign-off guards this.
 *  - **At most once.** The store's write is the check, so two people pressing
 *    the button together cannot both invoice. The engine's `alreadyRaised`
 *    blocker is the courtesy; the store is the control.
 */

export interface FeeView {
  readonly record: DealRecord;
  readonly position: FeePosition;
  readonly raised: readonly DealFee[];
}

async function buildPosition(record: DealRecord): Promise<FeeView> {
  const fees = await listDealFees(record.id);
  const live = fees.filter((f) => f.voidedAt === undefined);
  const appraisal = appraise(toWorkingDeal(record.inputs).inputs);

  return {
    record,
    raised: fees,
    position: feePosition({
      appraisal,
      status: record.status,
      permissionsHeld: permissionsHeld(),
      ...(record.feeDisclosure !== undefined ? { disclosure: record.feeDisclosure } : {}),
      raised: live.map((f) => f.feeKey),
    }),
  };
}

export async function feesForDeal(dealId: string): Promise<FeeView | undefined> {
  const record = await getDeal(dealId);
  if (record === undefined) return undefined;
  return buildPosition(record);
}

export interface FeeOutcome {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * Record what the seller was told, and when.
 *
 * Separate from raising the fee and necessarily earlier: s.18 requires the
 * client to be told before they are bound, so a disclosure captured on the
 * invoice screen is a disclosure given too late to be worth anything.
 */
export async function recordFeeDisclosure(
  dealId: string,
  wording: string,
  actor: Actor,
): Promise<FeeOutcome> {
  const authorisation = authoriseDecision(actor, wording);
  if (!authorisation.ok) return { ok: false, message: authorisation.reason };
  if (actor.kind !== "account") return { ok: false, message: authorisation.reason };

  const record = await getDeal(dealId);
  if (record === undefined) return { ok: false, message: "No such deal." };

  const disclosure: FeeDisclosure = {
    at: new Date().toISOString(),
    by: actor.name,
    wording: wording.trim(),
  };
  await saveDeal({ ...record, feeDisclosure: disclosure });
  await audit("fee-disclosure-recorded", {
    account: { id: actor.id, email: actor.email },
    subject: dealId,
    detail: disclosure.wording,
  });

  return {
    ok: true,
    message: `Recorded against ${actor.name}. The fees named in it are now collectable on this deal.`,
  };
}

export async function raiseFee(
  dealId: string,
  feeKey: FeeKey,
  note: string,
  actor: Actor,
): Promise<FeeOutcome> {
  const authorisation = authoriseDecision(actor, note);
  if (!authorisation.ok) return { ok: false, message: authorisation.reason };
  if (actor.kind !== "account") return { ok: false, message: authorisation.reason };

  const view = await feesForDeal(dealId);
  if (view === undefined) return { ok: false, message: "No such deal." };

  // Recomputed here rather than trusted from the request. A client that could
  // name its own amount could invoice whatever it liked.
  const fee = view.position.fees.find((f) => f.definition.key === feeKey);
  if (fee === undefined) return { ok: false, message: "No such fee." };
  if (!fee.chargeable) {
    return {
      ok: false,
      message: `${fee.definition.label} cannot be raised: ${fee.blockers.map((b) => b.reason).join(" ")}`,
    };
  }

  const definition = feeDefinition(feeKey);
  const record: DealFee = {
    id: randomUUID(),
    dealId,
    feeKey,
    payer: definition.payer,
    amount: fee.amount,
    basis: definition.basis,
    raisedAt: new Date().toISOString(),
    raisedByAccountId: actor.id,
    raisedByName: actor.name,
    ...(view.record.feeDisclosure !== undefined
      ? { disclosure: view.record.feeDisclosure }
      : {}),
    permissionsAtRaise: [...permissionsHeld()],
    note: note.trim(),
  };

  const written = await raiseDealFee(record);
  if (!written) {
    return {
      ok: false,
      message: "That fee is already live on this deal. Nothing was raised a second time.",
    };
  }

  await audit("fee-raised", {
    account: { id: actor.id, email: actor.email },
    subject: dealId,
    detail: `${definition.label} · ${fee.amount} pence · ${record.note}`,
  });

  return { ok: true, message: `${definition.label} raised, against ${actor.name}.` };
}

export async function voidFee(
  dealId: string,
  feeId: string,
  reason: string,
  actor: Actor,
): Promise<FeeOutcome> {
  const authorisation = authoriseDecision(actor, reason);
  if (!authorisation.ok) return { ok: false, message: authorisation.reason };
  if (actor.kind !== "account") return { ok: false, message: authorisation.reason };

  const voided = await voidDealFee(feeId, new Date().toISOString(), actor.name, reason.trim());
  if (!voided) {
    return { ok: false, message: "That fee is not live, so there was nothing to void." };
  }

  await audit("fee-voided", {
    account: { id: actor.id, email: actor.email },
    subject: dealId,
    detail: `${feeId} · ${reason.trim()}`,
  });

  return { ok: true, message: `Voided, against ${actor.name}. The record of it stays.` };
}

"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { getDeal, saveDeal } from "@backend/store/repository";
import { audit } from "@backend/audit";
import {
  ENHANCED_TRIGGERS,
  SELLER_KINDS,
  type EnhancedTrigger,
  type SellerDueDiligence,
  type SellerKind,
} from "@shared/domain/sellerDueDiligence";

/**
 * Recording the seller's due diligence.
 *
 * Three actions rather than one form, for the same reason as the buyer's
 * passport: identity, authority and risk are established by three different
 * things at three different times, and one form that writes all three invites
 * somebody to submit the parts they have and silently clear the rest.
 *
 * The dates are ours rather than the operator's, because these record when the
 * check was done and the check is being done now. That differs deliberately
 * from the buyer's funds evidence, where the date belongs to a document that
 * already existed.
 */

export interface CheckResult {
  readonly ok: boolean;
  readonly message: string;
}

function isKind(value: string): value is SellerKind {
  return SELLER_KINDS.some((k) => k.kind === value);
}

function isTrigger(value: string): value is EnhancedTrigger {
  return Object.prototype.hasOwnProperty.call(ENHANCED_TRIGGERS, value);
}

async function update(
  dealId: string,
  change: (current: SellerDueDiligence) => SellerDueDiligence,
  what: string,
): Promise<CheckResult> {
  const viewer = await requirePermission("view-seller-data", `/deals/${dealId}/seller-checks`);
  const account = viewerAccount(viewer);
  if (account === undefined) {
    return {
      ok: false,
      message:
        "A due diligence check is somebody stating they did it. The shared operator password is nobody in particular — sign in with your own account.",
    };
  }

  const record = await getDeal(dealId);
  if (record === undefined) return { ok: false, message: "No such deal." };

  const checks = change(record.sellerChecks ?? { kind: "individual" });
  await saveDeal({ ...record, sellerChecks: checks });
  await audit("seller-checks-recorded", {
    account,
    subject: dealId,
    detail: what,
  });

  revalidatePath(`/deals/${dealId}/seller-checks`);
  revalidatePath(`/opportunities/${dealId}`);
  return { ok: true, message: `Recorded against ${account.name}.` };
}

export async function recordIdentityAction(
  _previous: CheckResult | undefined,
  formData: FormData,
): Promise<CheckResult> {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const kind = String(formData.get("kind") ?? "").trim();
  const method = String(formData.get("method") ?? "").trim();
  const screened = formData.get("screened") === "on";

  if (!isKind(kind)) return { ok: false, message: "No such kind of seller." };
  if (method === "") return { ok: false, message: "Say how identity was verified." };
  if (!screened) {
    return {
      ok: false,
      message:
        "Screening is not optional. Dealing with a designated person is an offence regardless of what anybody knew, so it is recorded with the identity check or not at all.",
    };
  }

  const at = new Date().toISOString();
  return update(
    dealId,
    (current) => ({ ...current, kind, identityVerifiedAt: at, identityMethod: method, screenedAt: at }),
    "identity and screening",
  );
}

export async function recordAuthorityAction(
  _previous: CheckResult | undefined,
  formData: FormData,
): Promise<CheckResult> {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const evidence = String(formData.get("evidence") ?? "").trim();
  if (evidence === "") {
    return { ok: false, message: "Describe what was actually seen, not only that something was." };
  }
  return update(
    dealId,
    (current) => ({
      ...current,
      authorityEvidencedAt: new Date().toISOString(),
      authorityEvidence: evidence,
    }),
    "authority to sell",
  );
}

export async function recordRiskAction(
  _previous: CheckResult | undefined,
  formData: FormData,
): Promise<CheckResult> {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const measures = String(formData.get("measures") ?? "").trim();
  const triggers = formData
    .getAll("triggers")
    .map((t) => String(t))
    .filter(isTrigger);

  if (triggers.length > 0 && measures === "") {
    return {
      ok: false,
      message: "Say what was done about the triggers. A trigger with no measure recorded is a risk noted and ignored.",
    };
  }

  const viewer = await requirePermission("view-seller-data", `/deals/${dealId}/seller-checks`);
  const account = viewerAccount(viewer);
  if (account === undefined) {
    return { ok: false, message: "A risk assessment has an author. Sign in with your own account." };
  }

  return update(
    dealId,
    (current) => ({
      ...current,
      riskAssessedAt: new Date().toISOString(),
      riskAssessedBy: account.name,
      enhancedTriggers: triggers,
      ...(measures !== "" ? { enhancedMeasures: measures } : {}),
    }),
    `risk assessment${triggers.length > 0 ? ` · ${triggers.length} trigger(s)` : ""}`,
  );
}

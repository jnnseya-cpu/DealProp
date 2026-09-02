"use server";

import { revalidatePath } from "next/cache";
import { saveAccount } from "@backend/store/repository";
import { currentViewer } from "@/app/operator/guard";
import { audit } from "@backend/audit";
import { fromMajor } from "@shared/money";
import type { FundingKind, PassportEvidence, ProofOfFunds } from "@shared/domain/passport";

/**
 * Recording what has been checked about a buyer.
 *
 * Split into three actions rather than one form, because the three pieces are
 * established by three different things at three different times: identity by
 * a check, funds by a document, and a solicitor by an instruction. One form
 * that writes all three at once invites somebody to fill in the parts they
 * have and leave the rest blank, which would silently clear evidence that was
 * already there.
 *
 * Every date recorded here is the date of the evidence, not of the upload. A
 * bank statement uploaded today showing last February's balance is February's
 * evidence, and treating it as today's is how a stale balance passes a
 * freshness check.
 */

export interface PassportResult {
  readonly ok: boolean;
  readonly message: string;
}

const FUNDING_KINDS: readonly FundingKind[] = [
  "cash",
  "mortgage-in-principle",
  "bridging-terms",
  "backed-by-investor",
];

function isFundingKind(value: string): value is FundingKind {
  return FUNDING_KINDS.includes(value as FundingKind);
}

/** ISO-8601 for a date the browser sends as yyyy-mm-dd. Undefined if unusable. */
function isoDate(raw: FormDataEntryValue | null): string | undefined {
  const value = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

async function update(
  change: (current: PassportEvidence) => PassportEvidence,
  what: string,
): Promise<PassportResult> {
  const viewer = await currentViewer();
  if (viewer?.kind !== "account") {
    return {
      ok: false,
      message:
        "A passport belongs to a person. Sign in with your own account rather than the shared operator password.",
    };
  }

  const evidence = change(viewer.account.passportEvidence ?? {});
  await saveAccount({ ...viewer.account, passportEvidence: evidence });
  await audit("passport-evidence-recorded", {
    account: viewer.account,
    subject: viewer.account.id,
    detail: what,
  });
  revalidatePath("/account/passport");
  return { ok: true, message: `Recorded: ${what}.` };
}

export async function recordIdentityAction(
  _previous: PassportResult | undefined,
  formData: FormData,
): Promise<PassportResult> {
  const method = String(formData.get("method") ?? "").trim();
  const verifiedAt = isoDate(formData.get("verifiedAt"));
  const screenedAt = isoDate(formData.get("screenedAt"));

  if (method === "" || verifiedAt === undefined) {
    return { ok: false, message: "Both the method and the date of the check are needed." };
  }

  return update(
    (current) => ({
      ...current,
      identityVerifiedAt: verifiedAt,
      identityMethod: method,
      ...(screenedAt !== undefined ? { screenedAt } : {}),
    }),
    "identity check",
  );
}

export async function recordFundsAction(
  _previous: PassportResult | undefined,
  formData: FormData,
): Promise<PassportResult> {
  const kind = String(formData.get("kind") ?? "").trim();
  const issuer = String(formData.get("issuer") ?? "").trim();
  const evidencedAt = isoDate(formData.get("evidencedAt"));
  const expiresAt = isoDate(formData.get("expiresAt"));
  const amountMajor = Number(String(formData.get("amount") ?? "").replace(/[,\s£]/g, ""));

  if (!isFundingKind(kind)) return { ok: false, message: "No such kind of funding." };
  if (issuer === "" || evidencedAt === undefined) {
    return { ok: false, message: "Name who issued it and the date on the evidence itself." };
  }
  if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
    return { ok: false, message: "The amount has to be a positive figure." };
  }

  const proof: ProofOfFunds = {
    kind,
    evidencedAt,
    amount: fromMajor(amountMajor),
    issuer,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };

  return update(
    (current) => ({
      ...current,
      proofOfFunds: proof,
      // Source of funds is evidenced by the same document being produced, so it
      // is dated from the evidence rather than assumed from the upload.
      sourceOfFundsAt: evidencedAt,
    }),
    "proof of funds",
  );
}

export async function recordSolicitorAction(
  _previous: PassportResult | undefined,
  formData: FormData,
): Promise<PassportResult> {
  const solicitor = String(formData.get("solicitor") ?? "").trim();
  if (solicitor === "") return { ok: false, message: "Name the firm instructed." };
  return update((current) => ({ ...current, solicitor }), "conveyancer instructed");
}

"use server";

import { revalidatePath } from "next/cache";
import { currentViewer } from "@/app/operator/guard";
import { saveAccount } from "@backend/store/repository";
import {
  accountRoles,
  MAX_ACCOUNT_ROLES,
  REDRESS_SCHEME_LABELS,
  SELF_SERVICE_ROLES,
  withinRoleCap,
  type Account,
  type RedressScheme,
  type Role,
  type SourcerCompliance,
} from "@shared/domain/accounts";
import { requiredText, requireOneOf } from "@shared/formFields";
import { audit } from "@backend/audit";

/**
 * A person sets their own roles on their one account.
 *
 * This is what "sign up freely and independently, and be what you want" means
 * in practice: the normal path is self-service, not an admin. A signed-in person
 * may turn the self-service roles (seller, buyer/investor — a flipper is both)
 * on or off for themselves, whenever they like, on the single account they
 * already hold.
 *
 * What a person may NEVER self-grant, and this action never lets them: a staff
 * role (admin/operator) or a reserved role (estate agent, lender — a regulated
 * status nobody confers by a toggle). Any such role already on the account is
 * preserved untouched; it is simply not on offer here. Admin allocation stays
 * for the exceptional cases those represent.
 *
 * It is its own POST endpoint and checks its own permission — it only ever edits
 * the caller's own account (§29).
 */
export async function setOwnRoles(
  _previous: { ok: boolean; message: string } | undefined,
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const viewer = await currentViewer();
  if (viewer === undefined || viewer.kind !== "account") {
    return { ok: false, message: "Sign in to change what you do on Lode." };
  }
  const account = viewer.account;

  // Only the self-service roles are on offer to a person for themselves.
  const chosen = SELF_SERVICE_ROLES.filter((r) => formData.getAll("roles").includes(r));
  // Everything else the account holds — staff, reserved — is preserved exactly,
  // never granted and never removed from here.
  const preserved = accountRoles(account).filter((r) => !SELF_SERVICE_ROLES.includes(r));
  const finalRoles: readonly Role[] = [...chosen, ...preserved];
  if (finalRoles.length === 0) {
    return { ok: false, message: "Choose at least one — seller, buyer, or both." };
  }
  if (!withinRoleCap(finalRoles)) {
    return { ok: false, message: `An account may hold at most ${MAX_ACCOUNT_ROLES} roles.` };
  }

  const primary = finalRoles.includes(account.role) ? account.role : (finalRoles[0] as Role);
  const extra = finalRoles.filter((r) => r !== primary);

  const { roles: _roles, ...rest } = account;
  const next: Account = {
    ...rest,
    role: primary,
    ...(extra.length > 0 ? { roles: extra } : {}),
  };

  await saveAccount(next);
  await audit("account-created", {
    account,
    subject: account.id,
    detail: `Self-set roles: ${finalRoles.join(" + ")}.`,
  });
  revalidatePath("/account");
  return { ok: true, message: "Updated what you do on Lode." };
}

/**
 * A flipper records their own deal-sourcing compliance.
 *
 * Sourcing a deal and assigning it on for a margin is the sourcer's own
 * regulated act, so before Lode will facilitate that assignment and take its
 * share the flipper records, in their own name, their HMRC anti-money-laundering
 * registration and their redress-scheme membership. This only ever writes the
 * caller's own account (§29), and it records evidence — a claim with a date and
 * a reference on it — never a bare "I am compliant" flag. Whether the fee may
 * then be charged is decided by `assignmentMarginFeeStatement()`, which also
 * lapses the AML registration after a year; recording it here does not override
 * that check.
 */
export async function setSourcerCompliance(
  _previous: { ok: boolean; message: string } | undefined,
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const viewer = await currentViewer();
  if (viewer === undefined || viewer.kind !== "account") {
    return { ok: false, message: "Sign in to record your sourcing compliance." };
  }
  const account = viewer.account;

  let compliance: SourcerCompliance;
  try {
    const amlRegistration = requiredText(formData.get("amlRegistration"), "AML registration", 60);
    const amlConfirmedAt = requiredText(formData.get("amlConfirmedAt"), "AML confirmation date", 10);
    if (Number.isNaN(new Date(amlConfirmedAt).getTime())) {
      return { ok: false, message: "Enter the AML confirmation date as YYYY-MM-DD." };
    }
    if (amlConfirmedAt.slice(0, 10) > new Date().toISOString().slice(0, 10)) {
      return { ok: false, message: "The AML confirmation date cannot be in the future." };
    }
    const redressScheme = requireOneOf<RedressScheme>(
      formData.get("redressScheme"),
      new Set<string>(Object.keys(REDRESS_SCHEME_LABELS)),
      "redress scheme",
    );
    const redressMembership = requiredText(formData.get("redressMembership"), "Redress membership", 60);
    compliance = {
      amlRegistration,
      amlConfirmedAt: amlConfirmedAt.slice(0, 10),
      redressScheme,
      redressMembership,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Please check the form." };
  }

  const next: Account = { ...account, sourcerCompliance: compliance };
  await saveAccount(next);
  await audit("account-created", {
    account,
    subject: account.id,
    detail: `Recorded sourcing compliance: AML ${compliance.amlRegistration}, ${REDRESS_SCHEME_LABELS[compliance.redressScheme]} ${compliance.redressMembership}.`,
  });
  revalidatePath("/account");
  return { ok: true, message: "Recorded your sourcing compliance." };
}

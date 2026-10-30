"use server";

import { revalidatePath } from "next/cache";
import { currentViewer } from "@/app/operator/guard";
import { saveAccount } from "@backend/store/repository";
import { accountRoles, SELF_SERVICE_ROLES, type Account, type Role } from "@shared/domain/accounts";
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

"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOneOf, requiredText, type BoxFormResult } from "@/lib/formFields";
import { hashPassword, passwordProblem } from "@/lib/password";
import { ALL_ROLES, type Account, type Role } from "@/domain/accounts";
import { findAccountByEmail, getAccount, saveAccount } from "@/store/repository";
import { currentViewer, viewerAccount } from "@/app/operator/guard";
import { audit } from "@/lib/audit";

/**
 * Account management.
 *
 * Creating an account is the only way anybody gets a name in the audit trail,
 * so the first thing an administrator does is create one for themselves and
 * stop using the shared password.
 */

const ROLES = new Set<string>(ALL_ROLES);

export async function createAccount(
  _previous: BoxFormResult | undefined,
  formData: FormData,
): Promise<BoxFormResult> {
  const viewer = await currentViewer();
  if (viewer === undefined) {
    return { ok: false, message: "Sign in first." };
  }
  // The shared password may create accounts, because otherwise the first one
  // could never exist. A named account must hold the permission.
  if (viewer.kind === "account" && viewer.account.role !== "admin") {
    return { ok: false, message: "Only an administrator may create accounts." };
  }

  try {
    const email = requiredText(formData.get("email"), "Email", 200).toLowerCase();
    if (!email.includes("@")) throw new Error("That does not look like an email address");

    const existing = await findAccountByEmail(email);
    if (existing !== undefined) {
      return { ok: false, message: "An account already exists for that address." };
    }

    const password = String(formData.get("password") ?? "");
    const problem = passwordProblem(password);
    if (problem !== undefined) return { ok: false, message: problem.reason };

    const { hash, salt } = await hashPassword(password);
    const account: Account = {
      id: `acc-${randomUUID()}`,
      email,
      name: requiredText(formData.get("name"), "Name"),
      role: requireOneOf<Role>(formData.get("role"), ROLES, "role"),
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: new Date().toISOString(),
    };

    await saveAccount(account);
    await audit("account-created", {
      ...(viewerAccount(viewer) !== undefined ? { account: viewerAccount(viewer) } : {}),
      subject: account.id,
      detail: `${account.email} as ${account.role}`,
    });
    revalidatePath("/operator/accounts");

    return {
      ok: true,
      message:
        account.role === "investor" || account.role === "funder"
          ? `Created ${account.email}. They must certify at /account/certify before any deal material reaches them.`
          : `Created ${account.email} as ${account.role}.`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not create." };
  }
}

/**
 * Disable or re-enable an account.
 *
 * Never deleted. The audit trail refers to accounts by id, and deleting one
 * would leave entries pointing at nobody — which is exactly the evidence
 * somebody would want destroyed.
 */
export async function setAccountEnabled(id: string, enabled: boolean): Promise<void> {
  const viewer = await currentViewer();
  if (viewer === undefined) return;
  if (viewer.kind === "account" && viewer.account.role !== "admin") return;

  const account = await getAccount(id);
  if (account === undefined) return;

  const { disabledAt: _previous, ...rest } = account;
  const next: Account = enabled ? rest : { ...rest, disabledAt: new Date().toISOString() };

  await saveAccount(next);
  await audit(enabled ? "account-enabled" : "account-disabled", {
    ...(viewerAccount(viewer) !== undefined ? { account: viewerAccount(viewer) } : {}),
    subject: id,
    detail: account.email,
  });
  revalidatePath("/operator/accounts");
}

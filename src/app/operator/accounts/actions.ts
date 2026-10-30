"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOneOf, requiredText, type BoxFormResult } from "@shared/formFields";
import { hashPassword, passwordProblem } from "@backend/auth/password";
import { ALL_ROLES, type Account, type Role } from "@shared/domain/accounts";
import { findAccountByEmail, getAccount, listAccounts, saveAccount } from "@backend/store/repository";
import { currentViewer, viewerAccount } from "@/app/operator/guard";
import { audit } from "@backend/audit";
import { emit } from "@backend/notifications/engine";

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

    const role = requireOneOf<Role>(formData.get("role"), ROLES, "role");

    // Creating an administrator is the one role that grants account management
    // itself, so it is the one creation a shared credential must not make once
    // there is a real administrator to be accountable for it. A named admin may
    // create another admin; the shared operator password may mint the *first*
    // one to bootstrap the platform, and only while none exists.
    if (role === "admin" && !(viewer.kind === "account" && viewer.account.role === "admin")) {
      const activeAdmin = (await listAccounts()).some(
        (a) => a.role === "admin" && a.disabledAt === undefined,
      );
      if (activeAdmin) {
        return {
          ok: false,
          message:
            "An administrator already exists. Sign in as an administrator to create another — the shared password cannot, because there is nobody behind it to be accountable.",
        };
      }
    }

    const { hash, salt } = await hashPassword(password);
    // Only an administrator reaches this action, so allocating extra roles —
    // including the vetted ones (estate agent, lender) that self-service may
    // never claim — and marking the account a Lode/connected party are the
    // administrator's calls. One account, as many roles as they allocate.
    // A shared-operator may bootstrap accounts but may not mint staff, here or
    // via an extra role; only a named admin grants admin/operator.
    const canStaff = viewer.kind === "account" && viewer.account.role === "admin";
    const extraRoles = ALL_ROLES.filter(
      (r) =>
        r !== role &&
        formData.getAll("extraRoles").includes(r) &&
        (canStaff || (r !== "admin" && r !== "operator")),
    );
    const connectedParty = formData.get("connectedParty") === "on";
    const account: Account = {
      id: `acc-${randomUUID()}`,
      email,
      name: requiredText(formData.get("name"), "Name"),
      role,
      ...(extraRoles.length > 0 ? { roles: extraRoles } : {}),
      ...(connectedParty ? { connectedParty: true } : {}),
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
    // Welcome the new account. Idempotent on its id, and best-effort — a
    // notification failure must never fail account creation.
    await emit("account.registration.received", { account, dedupe: account.id }).catch(() => undefined);
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
 * Allocate the roles (and connected-party flag) on an existing account.
 *
 * This is how "one person, one account, many roles" actually works: a seller
 * who later also buys, or a firm Lode has vetted into an estate agent, has the
 * role ADDED to their single account rather than opening a second. Admin only —
 * it is the allocation power self-service deliberately lacks, and the only path
 * to the vetted roles (estate agent, lender). The primary role is kept where it
 * is still selected, so display and the audit "as ___" line stay stable.
 */
export async function setAccountRoles(
  _previous: BoxFormResult | undefined,
  formData: FormData,
): Promise<BoxFormResult> {
  const viewer = await currentViewer();
  if (viewer === undefined) return { ok: false, message: "Sign in first." };
  if (viewer.kind === "account" && viewer.account.role !== "admin") {
    return { ok: false, message: "Only an administrator may allocate roles." };
  }

  const id = String(formData.get("id") ?? "");
  const account = await getAccount(id);
  if (account === undefined) return { ok: false, message: "No such account." };

  const chosen = ALL_ROLES.filter((r) => formData.getAll("roles").includes(r));
  if (chosen.length === 0) return { ok: false, message: "An account must keep at least one role." };

  // Only an admin may grant admin or operator, and only an admin may grant them
  // here — the create action's bootstrap exception does not apply to an edit.
  if (
    (chosen.includes("admin") || chosen.includes("operator")) &&
    !(viewer.kind === "account" && viewer.account.role === "admin")
  ) {
    return { ok: false, message: "Only a named administrator may grant a staff role." };
  }

  // Keep the existing primary where it is still chosen; otherwise the first.
  const primary = chosen.includes(account.role) ? account.role : (chosen[0] as Role);
  const extra = chosen.filter((r) => r !== primary);
  const connectedParty = formData.get("connectedParty") === "on";

  const { roles: _r, connectedParty: _c, ...rest } = account;
  const next: Account = {
    ...rest,
    role: primary,
    ...(extra.length > 0 ? { roles: extra } : {}),
    ...(connectedParty ? { connectedParty: true } : {}),
  };

  await saveAccount(next);
  await audit("account-created", {
    ...(viewerAccount(viewer) !== undefined ? { account: viewerAccount(viewer) } : {}),
    subject: id,
    detail: `Roles allocated: ${chosen.join(" + ")}${connectedParty ? " · connected party" : ""}.`,
  });
  revalidatePath("/operator/accounts");
  return { ok: true, message: "Roles updated." };
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

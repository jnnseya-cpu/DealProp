"use server";

import { randomUUID } from "node:crypto";
import { cookies, headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { requireOneOf, requiredText, type BoxFormResult } from "@shared/formFields";
import { hashPassword, passwordProblem } from "@backend/auth/password";
import { SELF_SERVICE_ROLES, type Account, type Role } from "@shared/domain/accounts";
import { findAccountByEmail, saveAccount } from "@backend/store/repository";
import { createSession, SESSION_COOKIE, SESSION_SECONDS } from "@backend/auth/session";
import { cookieScope } from "@backend/auth/cookie";
import { audit } from "@backend/audit";
import { callerFrom, consume } from "@backend/rateLimit";

/**
 * Public self-service sign-up.
 *
 * The counterpart to operator-created accounts: a visitor from the site creates
 * their own account and is signed in. The guard rails are deliberate:
 *
 *  - Only `SELF_SERVICE_ROLES` may be chosen. A role that reaches seller data or
 *    the whole platform (admin, operator) is granted by a named administrator,
 *    never claimed on a form — `requireOneOf` against that set is what enforces
 *    it, so a crafted `role` field cannot mint an operator.
 *  - Investors and funders can sign up, but see no deal material until they
 *    certify (`can()` + `certificationStatus`), so self-registration widens who
 *    can sign up, never what a fresh account sees.
 *  - Rate-limited like sign-in: it writes a row and runs ~170ms of scrypt, so an
 *    open endpoint is both a spam vector and a denial of service.
 *  - It is its own POST endpoint, so it validates and authorises on the server
 *    and trusts nothing the client sent (§security).
 */
export async function register(
  _previous: BoxFormResult | undefined,
  formData: FormData,
): Promise<BoxFormResult> {
  const gate = consume("sign-up", callerFrom(await nextHeaders()));
  if (!gate.allowed) {
    return { ok: false, message: `Too many attempts. Try again in ${gate.retryAfterSeconds} seconds.` };
  }

  const secret = process.env.OPERATOR_SECRET;
  if (secret === undefined || secret === "") {
    // No signing secret means no session can be minted. Fail closed rather than
    // create an account nobody could sign in to.
    return { ok: false, message: "Sign-up is not available right now. Please try again shortly." };
  }

  let name: string;
  let email: string;
  let role: Role;
  try {
    name = requiredText(formData.get("name"), "Name", 120);
    email = requiredText(formData.get("email"), "Email", 200).toLowerCase();
    if (!email.includes("@")) return { ok: false, message: "That does not look like an email address." };
    role = requireOneOf<Role>(formData.get("role"), new Set<string>(SELF_SERVICE_ROLES), "role");
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Please check the form." };
  }

  const password = String(formData.get("password") ?? "");
  const problem = passwordProblem(password);
  if (problem !== undefined) return { ok: false, message: problem.reason };

  const existing = await findAccountByEmail(email);
  if (existing !== undefined) {
    // A sign-up form reveals that an address is taken — every one does, because
    // it cannot create a duplicate silently. We turn that into help rather than
    // a dead end, and point them at sign-in.
    return { ok: false, message: "An account already exists for that email — sign in instead." };
  }

  const { hash, salt } = await hashPassword(password);
  const account: Account = {
    id: `acc-${randomUUID()}`,
    email,
    name,
    role,
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: new Date().toISOString(),
  };
  await saveAccount(account);
  await audit("account-created", {
    account,
    subject: `account:${account.id}`,
    detail: `Self-service sign-up as ${role}.`,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSession(account.id, secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
    ...cookieScope(),
  });

  // Straight to their command centre. redirect() throws, so it is outside the
  // try above and after the cookie is set.
  redirect("/account");
}

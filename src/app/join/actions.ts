"use server";

import { randomUUID } from "node:crypto";
import { cookies, headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";
import { requireOneOf, requiredText, type BoxFormResult } from "@shared/formFields";
import { hashPassword, passwordProblem } from "@backend/auth/password";
import { isEmailVerified, SELF_SERVICE_ROLES, type Account, type Role } from "@shared/domain/accounts";
import {
  buildPendingCode,
  checkVerificationCode,
  emailDeliveryIsSandbox,
  generateVerificationCode,
  sendVerificationEmail,
} from "@backend/auth/emailVerification";
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
  let extraRoles: readonly Role[] = [];
  try {
    name = requiredText(formData.get("name"), "Name", 120);
    email = requiredText(formData.get("email"), "Email", 200).toLowerCase();
    if (!email.includes("@")) return { ok: false, message: "That does not look like an email address." };
    // "Flipper" is not a role of its own — it is someone who buys and sells, so
    // it maps to a multi-role account (buyer + seller). Every other choice is a
    // single self-service role, validated against the allowed set.
    if (String(formData.get("role")) === "flipper") {
      role = "investor";
      extraRoles = ["seller"];
    } else {
      role = requireOneOf<Role>(formData.get("role"), new Set<string>(SELF_SERVICE_ROLES), "role");
    }
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

  // Verification is delivered by email, so with no real provider configured the
  // code goes nowhere and the account could never be verified. In development
  // the console transport is fine (the code is logged); in production it is a
  // trap, so refuse rather than strand someone on an unverifiable account.
  if (process.env.NODE_ENV === "production" && emailDeliveryIsSandbox()) {
    return { ok: false, message: "Sign-up is temporarily unavailable. Please try again shortly." };
  }

  const { hash, salt } = await hashPassword(password);
  const code = generateVerificationCode();
  const account: Account = {
    id: `acc-${randomUUID()}`,
    email,
    name,
    role,
    ...(extraRoles.length > 0 ? { roles: extraRoles } : {}),
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: new Date().toISOString(),
    // Created unverified: it holds a pending code and cannot sign in until the
    // code is entered. No session is minted here.
    pendingEmailCode: buildPendingCode(code, secret),
  };

  // Send before persisting. If delivery fails there is no account left behind
  // under an address the person then cannot re-register or verify.
  const sent = await sendVerificationEmail(email, name, code);
  if (!sent.ok) {
    return { ok: false, message: "We couldn't send your verification email. Please try again in a moment." };
  }

  await saveAccount(account);
  await audit("account-created", {
    account,
    subject: `account:${account.id}`,
    detail: `Self-service sign-up as ${[role, ...extraRoles].join(" + ")}; email verification pending.`,
  });

  // No session yet — the account is not usable until verified. Straight to the
  // code-entry screen, carrying the address so it need not be retyped.
  // redirect() throws, so it is outside the try above.
  redirect(`/join/verify?email=${encodeURIComponent(email)}`);
}

/**
 * Complete sign-up by entering the emailed code.
 *
 * The account was created unverified and cannot sign in; this is the only path
 * that makes it usable. On success the pending code is cleared, the address is
 * marked verified, and the session is minted — so this, not `register`, is the
 * point at which sign-up actually signs someone in.
 */
export async function verifyEmailCode(
  _previous: BoxFormResult | undefined,
  formData: FormData,
): Promise<BoxFormResult> {
  const gate = consume("verify-email", callerFrom(await nextHeaders()));
  if (!gate.allowed) {
    return { ok: false, message: `Too many attempts. Try again in ${gate.retryAfterSeconds} seconds.` };
  }

  const secret = process.env.OPERATOR_SECRET;
  if (secret === undefined || secret === "") {
    return { ok: false, message: "Verification is not available right now. Please try again shortly." };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const code = String(formData.get("code") ?? "").trim();
  if (email === "" || code === "") {
    return { ok: false, message: "Enter the code we emailed you." };
  }

  const account = await findAccountByEmail(email);
  // A missing account and a wrong code return the same message, so this cannot
  // be used to discover which addresses are registered.
  if (account === undefined) {
    return { ok: false, message: "That code is not correct, or it has expired." };
  }
  if (account.emailVerifiedAt !== undefined && account.pendingEmailCode === undefined) {
    return { ok: false, message: "This account is already verified — please sign in." };
  }

  const check = checkVerificationCode(account.pendingEmailCode, code, secret);
  if (!check.ok) {
    if (account.pendingEmailCode !== undefined) {
      if (check.deadCode) {
        // Expired or out of attempts: clear it so it cannot be hammered further.
        const { pendingEmailCode: _spent, ...withoutCode } = account;
        await saveAccount(withoutCode);
      } else {
        // A plain wrong guess: spend one of the budget.
        await saveAccount({
          ...account,
          pendingEmailCode: { ...account.pendingEmailCode, attempts: account.pendingEmailCode.attempts + 1 },
        });
      }
    }
    return { ok: false, message: check.reason };
  }

  // Verified: drop the pending code and record the moment.
  const { pendingEmailCode: _done, ...withoutCode } = account;
  const verified: Account = { ...withoutCode, emailVerifiedAt: new Date().toISOString() };
  await saveAccount(verified);
  await audit("email-verified", {
    account: verified,
    subject: `account:${verified.id}`,
    detail: "Email verified at sign-up.",
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSession(verified.id, secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
    ...cookieScope(),
  });

  // redirect() throws, so it is outside any try and after the cookie is set.
  redirect("/account");
}

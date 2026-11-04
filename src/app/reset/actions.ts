"use server";

import { cookies, headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";
import type { BoxFormResult } from "@shared/formFields";
import type { Account } from "@shared/domain/accounts";
import { hashPassword, passwordProblem } from "@backend/auth/password";
import {
  buildPendingReset,
  checkResetToken,
  generateResetToken,
  sendPasswordResetEmail,
} from "@backend/auth/passwordReset";
import { createSession, SESSION_COOKIE, SESSION_SECONDS } from "@backend/auth/session";
import { cookieScope } from "@backend/auth/cookie";
import { findAccountByEmail, saveAccount } from "@backend/store/repository";
import { audit } from "@backend/audit";
import { callerFrom, consume } from "@backend/rateLimit";

/**
 * Password reset — the two halves of "I forgot my password".
 *
 * `requestPasswordReset` emails a single-use link; `completePasswordReset`
 * accepts the token from that link with a new password. Both are their own POST
 * endpoints that validate and authorise on the server, both are rate-limited,
 * and the request half is enumeration-safe: it returns the same message whether
 * or not the address has an account.
 */

export async function requestPasswordReset(
  _previous: BoxFormResult | undefined,
  formData: FormData,
): Promise<BoxFormResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const gate = consume("password-reset-request", `${callerFrom(await nextHeaders())}|${email}`);
  if (!gate.allowed) {
    return { ok: false, message: `Too many requests. Try again in ${gate.retryAfterSeconds} seconds.` };
  }

  const secret = process.env.OPERATOR_SECRET;
  if (secret === undefined || secret === "") {
    return { ok: false, message: "Password reset is not available right now. Please try again shortly." };
  }
  if (email === "" || !email.includes("@")) {
    return { ok: false, message: "Enter the email address on your account." };
  }

  // Same outcome whatever we find, so this cannot reveal which addresses have an
  // account. A link is only actually sent to a real, active account.
  const neutral: BoxFormResult = {
    ok: true,
    message:
      "If that address has an account, a reset link is on its way. Check your inbox and your spam folder — the link expires in an hour.",
  };

  const account = await findAccountByEmail(email);
  if (account === undefined || account.disabledAt !== undefined) return neutral;

  const token = generateResetToken();
  const sent = await sendPasswordResetEmail(email, account.name, token);
  // A send failure is swallowed into the neutral message on purpose: surfacing
  // it here would tell an attacker the address exists. The person who really
  // owns it can simply ask again.
  if (sent.ok) {
    await saveAccount({ ...account, pendingPasswordReset: buildPendingReset(token, secret) });
    await audit("password-reset-requested", {
      account,
      subject: `account:${account.id}`,
      detail: "Password reset link issued.",
    });
  }
  return neutral;
}

export async function completePasswordReset(
  _previous: BoxFormResult | undefined,
  formData: FormData,
): Promise<BoxFormResult> {
  const gate = consume("password-reset", callerFrom(await nextHeaders()));
  if (!gate.allowed) {
    return { ok: false, message: `Too many attempts. Try again in ${gate.retryAfterSeconds} seconds.` };
  }

  const secret = process.env.OPERATOR_SECRET;
  if (secret === undefined || secret === "") {
    return { ok: false, message: "Password reset is not available right now. Please try again shortly." };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (email === "" || token === "") {
    return { ok: false, message: "That reset link is incomplete. Request a new one." };
  }

  const problem = passwordProblem(password);
  if (problem !== undefined) return { ok: false, message: problem.reason };

  const account = await findAccountByEmail(email);
  // A missing account and a bad token look the same, so this cannot be used to
  // probe which addresses exist.
  if (account === undefined || account.disabledAt !== undefined) {
    return { ok: false, message: "That reset link is invalid or has expired. Request a new one." };
  }

  const check = checkResetToken(account.pendingPasswordReset, token, secret);
  if (!check.ok) return { ok: false, message: check.reason };

  const { hash, salt } = await hashPassword(password);
  // Setting a new password spends the token, and — because receiving the reset
  // email proves control of the address — also clears any outstanding email
  // verification, so an account cannot be left unable to sign in right after a
  // successful reset.
  const { pendingPasswordReset: _usedReset, pendingEmailCode: _clearedCode, ...rest } = account;
  const updated: Account = {
    ...rest,
    passwordHash: hash,
    passwordSalt: salt,
    emailVerifiedAt: account.emailVerifiedAt ?? new Date().toISOString(),
  };
  await saveAccount(updated);
  await audit("password-reset", {
    account: updated,
    subject: `account:${updated.id}`,
    detail: "Password reset completed.",
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSession(updated.id, secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
    ...cookieScope(),
  });

  // redirect() throws, so it is after the cookie is set and outside any try.
  redirect("/account");
}

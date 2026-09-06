"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers as nextHeaders } from "next/headers";
import { redirect } from "next/navigation";
import {
  OPERATOR_COOKIE,
  OPERATOR_SESSION_SECONDS,
  operatorCookieValue,
  operatorPasswordMatches,
} from "@backend/auth/operator";
import { createSession, SESSION_COOKIE, SESSION_SECONDS } from "@backend/auth/session";
import { hashPassword, needsRehash, verifyPassword } from "@backend/auth/password";
import { findAccountByEmail, saveAccount } from "@backend/store/repository";
import { audit } from "@backend/audit";
import { callerFrom, consume } from "@backend/rateLimit";

/**
 * Operator sign-in.
 *
 * The failure message never distinguishes "not configured" from "wrong
 * password", because the first tells an attacker the deployment is
 * misconfigured and worth returning to.
 */
export async function signIn(
  _previous: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const secret = process.env.OPERATOR_SECRET;
  const submitted = String(formData.get("password") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const next = String(formData.get("next") ?? "/deals");

  /*
    Counted before a password is checked, not after.

    Verifying costs ~170ms of scrypt on a single-threaded runtime, so an
    unlimited sign-in endpoint is a denial of service that needs no
    vulnerability and barely any traffic: six attempts a second saturate a
    core and every other request on the instance waits behind them. The limit
    is what makes the memory-hard hash affordable rather than a liability.

    Bucketed by caller and address together, so somebody guessing at one
    account cannot lock out every other person behind the same office NAT.
  */
  const headers = await nextHeaders();
  const gate = consume("sign-in", `${callerFrom(headers)}|${email.toLowerCase()}`);
  if (!gate.allowed) {
    await audit("sign-in-failed", { detail: "rate limited" });
    return `Too many attempts. Try again in ${gate.retryAfterSeconds} seconds.`;
  }

  // A named account first. The shared password remains as the bootstrap — it
  // is what creates the first administrator, and what a solo operator uses on
  // day one — but a person with an account signs in as themselves so the audit
  // trail has somebody to name.
  if (email !== "") {
    const account = await findAccountByEmail(email);
    const ok =
      account !== undefined &&
      account.disabledAt === undefined &&
      (await verifyPassword(submitted, account.passwordHash, account.passwordSalt));

    if (!ok || account === undefined) {
      // Deliberately the same message whether the address is unknown, the
      // password is wrong, or the account is disabled. Distinguishing them
      // tells an attacker which addresses are real.
      await audit("sign-in-failed", { email });
      return "That email and password do not match an active account.";
    }

    // The one moment the plaintext is available, so the one moment a hash made
    // at weaker parameters can be upgraded. Best-effort: a failure here must
    // not stop somebody signing in with a correct password.
    if (needsRehash(account.passwordHash)) {
      try {
        const upgraded = await hashPassword(submitted);
        await saveAccount({
          ...account,
          passwordHash: upgraded.hash,
          passwordSalt: upgraded.salt,
        });
      } catch (error) {
        process.stderr.write(`password rehash failed for ${account.id}: ${String(error)}\n`);
      }
    }

    const jar = await cookies();
    jar.set(SESSION_COOKIE, await createSession(account.id, secret ?? ""), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_SECONDS,
    });
    await audit("sign-in", { account });
    revalidatePath("/", "layout");
    redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/deals");
  }

  if (!(await operatorPasswordMatches(submitted, secret))) {
    await audit("sign-in-failed", { detail: "shared operator password" });
    return "That is not the operator password.";
  }

  const jar = await cookies();
  jar.set(OPERATOR_COOKIE, await operatorCookieValue(secret ?? ""), {
    // Not readable from JavaScript, so an XSS cannot lift the session.
    httpOnly: true,
    // Sent over TLS only in production; localhost has no certificate.
    secure: process.env.NODE_ENV === "production",
    // `lax` still allows the redirect below to carry the cookie.
    sameSite: "lax",
    path: "/",
    maxAge: OPERATOR_SESSION_SECONDS,
  });

  // Signing in changes what every operator route returns, and the router may
  // still hold the middleware redirect it cached while signed out. Clearing the
  // cache here means the first navigation after signing in cannot replay it.
  revalidatePath("/", "layout");

  // Only same-origin paths, so a crafted `next` cannot bounce a signed-in
  // operator to an attacker's site.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/deals");
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(OPERATOR_COOKIE);
  jar.delete(SESSION_COOKIE);
  await audit("sign-out");
  // The mirror of sign-in: the router must not keep serving pages it cached
  // while the session was valid.
  revalidatePath("/", "layout");
  redirect("/operator");
}

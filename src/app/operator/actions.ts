"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  OPERATOR_COOKIE,
  OPERATOR_SESSION_SECONDS,
  operatorCookieValue,
  operatorPasswordMatches,
} from "@/lib/operator";

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
  const next = String(formData.get("next") ?? "/deals");

  if (!(await operatorPasswordMatches(submitted, secret))) {
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
  // The mirror of sign-in: the router must not keep serving pages it cached
  // while the session was valid.
  revalidatePath("/", "layout");
  redirect("/operator");
}

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PendingPasswordReset } from "@shared/domain/accounts";
import { resolveTransport, type SendOutcome } from "@backend/email";
import { siteUrl } from "@backend/site";

/**
 * Password reset.
 *
 * "Forgot my password" issues a single-use, high-entropy token, emailed as a
 * link, which lets the holder set a new password once. A reset hands whoever
 * holds the link full control of the account, so this is deliberately NOT a
 * short code like sign-up verification: a six-digit code is brute-forceable and
 * too weak for that even behind a rate limit. The token is 32 random bytes, the
 * link is a capability URL (the same shape as the seller links), and only its
 * HMAC under OPERATOR_SECRET is stored — a leaked store reveals no live tokens.
 *
 * Pure node:crypto: this only runs server-side in a server action.
 */

/** How long a reset link is good for. Long enough to read an email, no longer. */
export const RESET_TTL_MINUTES = 60;

/** A URL-safe, high-entropy token. 32 bytes is 256 bits — not guessable. */
export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

/** HMAC of the token under the server secret; what is stored on the account. */
export function hashResetToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

/** Build the pending-reset record to store on an account. */
export function buildPendingReset(
  token: string,
  secret: string,
  now: Date = new Date(),
): PendingPasswordReset {
  const expiresAt = new Date(now.getTime() + RESET_TTL_MINUTES * 60_000).toISOString();
  return { tokenHash: hashResetToken(token, secret), expiresAt };
}

export type ResetCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Check a submitted token against the pending record.
 *
 * Expiry, absence and a wrong token all return the same shape: a reset link
 * that does not currently work, without telling the holder which of those it
 * is. The comparison is constant-time.
 */
export function checkResetToken(
  pending: PendingPasswordReset | undefined,
  submitted: string,
  secret: string,
  now: Date = new Date(),
): ResetCheck {
  const bad = "That reset link is invalid or has expired. Request a new one.";
  if (pending === undefined || submitted.trim() === "") return { ok: false, reason: bad };
  if (new Date(pending.expiresAt).getTime() <= now.getTime()) return { ok: false, reason: bad };

  const expected = Buffer.from(hashResetToken(submitted.trim(), secret), "hex");
  const held = Buffer.from(pending.tokenHash, "hex");
  const matches = expected.length === held.length && timingSafeEqual(expected, held);
  return matches ? { ok: true } : { ok: false, reason: bad };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Email the reset link.
 *
 * The link carries the token and the address as a capability URL. Uses the
 * shared transport, so with no provider configured it logs and sends nothing —
 * the request action treats that as a silent no-op rather than revealing
 * anything, keeping the flow enumeration-safe.
 */
export async function sendPasswordResetEmail(
  to: string,
  name: string,
  token: string,
): Promise<SendOutcome> {
  const site = siteUrl();
  const link = `${site}/reset?token=${encodeURIComponent(token)}&email=${encodeURIComponent(to)}`;
  const subject = "Reset your Lode password";
  const text = [
    `Hi ${name},`,
    "",
    "We received a request to reset your Lode password. Open this link to set a new one:",
    link,
    "",
    `The link expires in ${RESET_TTL_MINUTES} minutes and can be used once.`,
    "",
    "If you did not ask to reset your password, ignore this email — your password has not changed.",
  ].join("\n");
  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    "<p>We received a request to reset your Lode password. Use the button below to set a new one:</p>",
    `<p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#d4af37;color:#121212;border-radius:8px;text-decoration:none;font-weight:600">Reset my password</a></p>`,
    `<p style="font-size:13px;color:#666">Or paste this link: ${link}</p>`,
    `<p>The link expires in ${RESET_TTL_MINUTES} minutes and can be used once.</p>`,
    "<p>If you did not ask to reset your password, ignore this email — your password has not changed.</p>",
  ].join("");

  return resolveTransport().send({ to, subject, text, html, unsubscribeUrl: `${site}/` });
}

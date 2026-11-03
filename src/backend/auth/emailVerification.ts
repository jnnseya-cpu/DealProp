import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { PendingEmailCode } from "@shared/domain/accounts";
import { resolveTransport, type SendOutcome } from "@backend/email";
import { siteUrl } from "@backend/site";

/**
 * Email verification at sign-up.
 *
 * Every new account must prove it controls the address it registered with by
 * entering a code sent to it once, at sign-up. This is what makes sign-up a
 * human holding a real mailbox rather than a script filling a form: an account
 * is created unverified, cannot sign in, and only becomes usable once the code
 * is entered. The code is sent once and never again on sign-in — it proves the
 * address, it is not a second factor on every login.
 *
 * The code is stored only as an HMAC under OPERATOR_SECRET (see
 * {@link PendingEmailCode}). A six-digit code is low entropy on purpose — it
 * has to be typed from an email — so safety comes from the short expiry, the
 * single use, the attempt cap here, and the sign-up rate limit at the call
 * site, not from length. Pure node:crypto: this only ever runs server-side in
 * a server action, never in the edge middleware.
 */

/** How long a code is good for. Long enough to find the email, short enough to matter. */
export const CODE_TTL_MINUTES = 30;

/** Wrong guesses allowed before the code is dead and sign-up must start over. */
export const MAX_VERIFICATION_ATTEMPTS = 6;

/** A six-digit numeric code, uniformly random across the whole range. */
export function generateVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * HMAC of the code under the server secret.
 *
 * Keyed rather than a bare digest: a plain SHA-256 of a six-digit code is
 * reversible in a million tries, so without the secret a leaked store would
 * hand over every live code. The HMAC makes the stored value useless to
 * anybody who does not also hold OPERATOR_SECRET.
 */
export function hashVerificationCode(code: string, secret: string): string {
  return createHmac("sha256", secret).update(code).digest("hex");
}

/** Build the pending-code record to store on a freshly created account. */
export function buildPendingCode(
  code: string,
  secret: string,
  now: Date = new Date(),
): PendingEmailCode {
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60_000).toISOString();
  return { codeHash: hashVerificationCode(code, secret), expiresAt, attempts: 0 };
}

export type CodeCheck =
  | { readonly ok: true }
  /** `deadCode` means the code can never succeed now — expired or out of attempts — so the caller clears it and tells the person to start over. */
  | { readonly ok: false; readonly reason: string; readonly deadCode: boolean };

/**
 * Check a submitted code against the pending record.
 *
 * Returns `deadCode: true` for expiry or a spent attempt budget — states the
 * caller resolves by clearing the pending code, not by letting another guess
 * through. A plain wrong code is `deadCode: false`: the caller records the
 * attempt and lets them try again until the budget runs out.
 */
export function checkVerificationCode(
  pending: PendingEmailCode | undefined,
  submitted: string,
  secret: string,
  now: Date = new Date(),
): CodeCheck {
  if (pending === undefined) {
    return { ok: false, reason: "There is nothing to verify for this account.", deadCode: true };
  }
  if (new Date(pending.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: "That code has expired. Please sign up again to get a new one.", deadCode: true };
  }
  if (pending.attempts >= MAX_VERIFICATION_ATTEMPTS) {
    return { ok: false, reason: "Too many incorrect codes. Please sign up again to get a new one.", deadCode: true };
  }

  const expected = Buffer.from(hashVerificationCode(submitted.trim(), secret), "hex");
  const held = Buffer.from(pending.codeHash, "hex");
  const matches = expected.length === held.length && timingSafeEqual(expected, held);
  if (!matches) {
    return { ok: false, reason: "That code is not correct.", deadCode: false };
  }
  return { ok: true };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Send the verification code to the address.
 *
 * Uses the same transport as every other email, so with no provider configured
 * it writes to the server log and sends nothing — which is why the sign-up
 * action refuses to create accounts in production when the transport is the
 * console sandbox, rather than trapping people on an account they can never
 * verify. Transactional, so it carries no marketing unsubscribe beyond the
 * site link the header shape requires.
 */
export async function sendVerificationEmail(
  to: string,
  name: string,
  code: string,
): Promise<SendOutcome> {
  const site = siteUrl();
  const subject = "Your Lode verification code";
  const text = [
    `Hi ${name},`,
    "",
    `Your Lode verification code is ${code}.`,
    "",
    `Enter it on the sign-up screen to activate your account. It expires in ${CODE_TTL_MINUTES} minutes.`,
    "",
    "If you did not create a Lode account, you can ignore this email.",
  ].join("\n");
  const html = [
    `<p>Hi ${escapeHtml(name)},</p>`,
    `<p>Your Lode verification code is <strong style="font-size:22px;letter-spacing:4px">${code}</strong>.</p>`,
    `<p>Enter it on the sign-up screen to activate your account. It expires in ${CODE_TTL_MINUTES} minutes.</p>`,
    "<p>If you did not create a Lode account, you can ignore this email.</p>",
  ].join("");

  return resolveTransport().send({ to, subject, text, html, unsubscribeUrl: `${site}/` });
}

/** True where no real email provider is configured, so delivery is a no-op. */
export function emailDeliveryIsSandbox(): boolean {
  return resolveTransport().name === "console";
}

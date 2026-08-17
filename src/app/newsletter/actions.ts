"use server";

import { newToken } from "@/lib/tokens";
import { resolveTransport, type EmailMessage } from "@/lib/email";
import {
  absolute,
  CONSENT_TEXT,
  escapeHtml,
  normaliseEmail,
  type Audience,
  type Subscriber,
} from "@/domain/newsletter";
import { findSubscriberByEmail, saveSubscriber } from "@/store/repository";

/**
 * Newsletter subscription.
 *
 * Double opt-in. Submitting the form creates a `pending` record and sends a
 * confirmation link; the address is not mailable until that link is clicked.
 * This exists for two reasons: it proves the person controls the inbox, and it
 * stops anyone signing up somebody else's address.
 */

/**
 * The same response regardless of whether the address was new, pending or
 * already subscribed. Saying "you are already on the list" would confirm
 * membership to anyone who typed someone else's address.
 */
const CONFIRMATION_SENT =
  "Check your inbox. We have sent you a link to confirm — you will not receive anything until you click it.";

const AUDIENCES: readonly Audience[] = ["investor", "funder", "professional", "curious"];

export type SubscribeResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly error: string };

export async function subscribe(
  _previous: SubscribeResult | undefined,
  formData: FormData,
): Promise<SubscribeResult> {
  const email = normaliseEmail(String(formData.get("email") ?? ""));
  if (email === undefined) {
    return { ok: false, error: "That does not look like an email address." };
  }

  if (formData.get("consent") !== "on") {
    return { ok: false, error: "We cannot add you without your consent." };
  }

  // A honeypot field no human sees. Bots fill every input they find, and it
  // costs nothing compared with a captcha that penalises real users. Reporting
  // success rather than detection avoids teaching the bot to adapt.
  if (String(formData.get("website") ?? "") !== "") {
    return { ok: true, message: CONFIRMATION_SENT };
  }

  const rawAudience = String(formData.get("audience") ?? "");
  const audience: Audience = AUDIENCES.find((a) => a === rawAudience) ?? "curious";

  const existing = await findSubscriberByEmail(email);
  if (existing?.status === "confirmed") {
    return { ok: true, message: CONFIRMATION_SENT };
  }

  const now = new Date().toISOString();
  const subscriber: Subscriber = {
    id: existing?.id ?? `sub-${newToken().slice(0, 12)}`,
    email,
    audience,
    status: "pending",
    consentText: CONSENT_TEXT,
    createdAt: existing?.createdAt ?? now,
    // A fresh confirm token each time, so an older link cannot be replayed.
    confirmToken: newToken(),
    unsubscribeToken: existing?.unsubscribeToken ?? newToken(),
    source: "newsletter-form",
  };

  await saveSubscriber(subscriber);

  const baseUrl = siteUrl();
  const confirmUrl = absolute(baseUrl, `/newsletter/confirm?token=${subscriber.confirmToken}`);
  const unsubscribeUrl = absolute(
    baseUrl,
    `/newsletter/unsubscribe?token=${subscriber.unsubscribeToken}`,
  );

  const message: EmailMessage = {
    to: email,
    subject: "Confirm your Lode subscription",
    html: confirmationHtml(confirmUrl),
    text: confirmationText(confirmUrl),
    unsubscribeUrl,
  };

  const outcome = await resolveTransport().send(message);
  if (!outcome.ok) {
    // The record stays `pending`, so retrying re-sends rather than losing them.
    return {
      ok: false,
      error: "We could not send the confirmation email just now. Please try again shortly.",
    };
  }

  return { ok: true, message: CONFIRMATION_SENT };
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

function confirmationHtml(confirmUrl: string): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"></head>
<body style="margin:0;background:#0a0a0b;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" style="max-width:520px;">
  <tr><td style="font:600 22px/1 Georgia,serif;color:#e6e6ec;padding-bottom:22px;">Lode</td></tr>
  <tr><td style="font:400 16px/1.6 -apple-system,Segoe UI,sans-serif;color:#c4c4ce;padding-bottom:22px;">
    Confirm you want the weekly Lode email. One click and you are done.
  </td></tr>
  <tr><td style="padding-bottom:22px;">
    <a href="${escapeHtml(confirmUrl)}" style="display:inline-block;background:#d4a94b;color:#0a0a0b;font:600 15px/1 -apple-system,sans-serif;padding:14px 26px;border-radius:999px;text-decoration:none;">Confirm subscription</a>
  </td></tr>
  <tr><td style="font:400 13px/1.6 -apple-system,sans-serif;color:#6f6f7d;">
    If you did not ask for this, ignore this email — nothing will be sent to you and
    the request expires unused. We never add an address that has not confirmed.
  </td></tr>
</table></td></tr></table></body></html>`;
}

function confirmationText(confirmUrl: string): string {
  return [
    "LODE",
    "",
    "Confirm you want the weekly Lode email:",
    confirmUrl,
    "",
    "If you did not ask for this, ignore this email — nothing will be sent to you.",
    "We never add an address that has not confirmed.",
  ].join("\n");
}

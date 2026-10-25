import type { Account } from "@shared/domain/accounts";
import {
  notificationEvent,
  routeEvent,
  type Channel,
  type ChannelContext,
  type NotificationEvent,
} from "@shared/domain/notifications";
import { companyIdentity, registrationLine } from "@shared/domain/identity";
import { resolveTransport } from "@backend/email";
import { listSuppressions, recordNotification } from "@backend/store/repository";
import type { StoredNotification } from "@backend/store/schema";

/**
 * The communication engine — emit an event, fan it out across its lawful
 * channels.
 *
 * It decides nothing about legality itself: `routeEvent` (the pure domain core,
 * tested in isolation) does that, and this renders and dispatches whatever that
 * permits. It is deterministic and fails safe — with no email provider
 * configured the transport is the console one, so an email is recorded as
 * `sandbox` rather than sent, exactly like screening and billing. SMS and push
 * have no adapter yet and are recorded as `sandbox` too, so the flow is always
 * testable before the keys exist.
 *
 * Marketing consent is not yet stored anywhere, so it is read as absent, which
 * means a marketing event can only ever reach the in-app inbox until a consent
 * record exists. That is the correct fail-closed direction (§10): silence, not
 * an unconsented mail.
 */

export interface EmitOptions {
  /** The recipient. Only a named account can receive one (the inbox is theirs). */
  readonly account: Account;
  /**
   * A token that makes this emit idempotent — a payment id, a deal id, a day
   * stamp. Two emits with the same token and channel write one row. Defaults to
   * the current instant, i.e. not deduped.
   */
  readonly dedupe?: string;
}

export interface EmitResult {
  readonly delivered: readonly Channel[];
  readonly decisions: ReturnType<typeof routeEvent>;
}

export async function emit(eventKey: string, options: EmitOptions): Promise<EmitResult> {
  const event = notificationEvent(eventKey);
  if (event === undefined) {
    // An unknown key is a programming error, not a runtime one — do nothing
    // rather than invent an event. The caller gets an empty result.
    return { delivered: [], decisions: [] };
  }

  const account = options.account;
  const now = new Date().toISOString();
  const dedupe = options.dedupe ?? now;

  // An email opt-out or spam complaint on this address blocks email for
  // everything except a security notice, which routeEvent handles.
  const suppressions = await listSuppressions();
  const emailSuppressed = suppressions.some(
    (s) => s.email.toLowerCase() === account.email.toLowerCase(),
  );

  const ctx: ChannelContext = {
    reachable: { inapp: true, email: account.email !== "", sms: false, push: false },
    // No consent store yet, so marketing is unconsented everywhere — fail closed.
    marketingConsent: { inapp: false, email: false, sms: false, push: false },
    suppressed: { inapp: false, email: emailSuppressed, sms: false, push: false },
  };

  const decisions = routeEvent(event, ctx);
  const transport = resolveTransport();
  const delivered: Channel[] = [];

  for (const decision of decisions) {
    if (!decision.permitted) continue;
    const id = `${eventKey}:${account.id}:${decision.channel}:${dedupe}`;

    let status: StoredNotification["status"];
    if (decision.channel === "email") {
      const outcome = await transport.send({
        to: account.email,
        subject: event.title,
        html: renderHtml(event, account),
        text: renderText(event, account),
        unsubscribeUrl: `${siteUrl()}/account/profile`,
      });
      status = outcome.ok ? (transport.name === "console" ? "sandbox" : "sent") : "failed";
    } else if (decision.channel === "inapp") {
      status = "logged";
    } else {
      // sms / push: no adapter configured, so recorded but not sent.
      status = "sandbox";
    }

    const { created } = await recordNotification({
      id,
      eventKey,
      recipientAccountId: account.id,
      channel: decision.channel,
      lawfulBasis: event.lawfulBasis,
      severity: event.severity,
      status,
      subject: event.title,
      createdAt: now,
    });
    if (created && status !== "failed") delivered.push(decision.channel);
  }

  return { delivered, decisions };
}

function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  return configured !== undefined && configured !== "" ? configured.replace(/\/$/, "") : "";
}

/** A plain branded body. The engine never states a figure; the title carries the meaning. */
function renderText(event: NotificationEvent, account: Account): string {
  const identity = companyIdentity(process.env);
  const reg = registrationLine(identity) ?? identity.tradingName ?? "Lode";
  return [`Hello ${account.name},`, "", event.title, "", "— Lode", reg].join("\n");
}

function renderHtml(event: NotificationEvent, account: Account): string {
  const identity = companyIdentity(process.env);
  const reg = registrationLine(identity) ?? identity.tradingName ?? "Lode";
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  return [
    `<div style="font-family:system-ui,sans-serif;color:#15181c">`,
    `<p>Hello ${esc(account.name)},</p>`,
    `<p style="font-size:17px">${esc(event.title)}</p>`,
    `<hr style="border:none;border-top:1px solid #e5e2da;margin:20px 0" />`,
    `<p style="font-size:12px;color:#6b685f">${esc(reg)}</p>`,
    `</div>`,
  ].join("");
}

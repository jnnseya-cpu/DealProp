/**
 * The communication event engine — the pure, deterministic core.
 *
 * This is the part of the §18 architecture that keeps it lawful, so it lives in
 * the domain where it is framework-free and fully testable, and it decides one
 * thing: given an event and what is true about a recipient, which channels may
 * it be sent on. The backend engine (`src/backend/notifications`) renders and
 * dispatches; it never re-decides this.
 *
 * Two rules, because Lode contacts consumers and individual property owners,
 * not signed-in enterprise staff:
 *
 *  1. **Lawful basis per event, never a "mandatory" flag that overrides a
 *     person's wishes.** A service or security message is lawful because of its
 *     basis (PECR permits transactional contact with the person who
 *     transacted), not because a flag beats their opt-out. A marketing message
 *     is lawful only with recorded consent.
 *  2. **A complaint or opt-out always wins** for marketing and service alike.
 *     The one thing it cannot silence is a security message to the account
 *     holder — a "your password changed" notice is not suppressible, because
 *     withholding it is the greater harm.
 *
 * And channel legality: marketing to an *individual* by SMS or push is refused
 * outright (PECR reg. 22 — the same rule that governs seller outreach), so a
 * marketing event never routes there however the catalogue is configured.
 */

export const CHANNELS = ["inapp", "email", "sms", "push"] as const;
export type Channel = (typeof CHANNELS)[number];

export type LawfulBasis = "service" | "security" | "marketing";

export type Severity = "info" | "success" | "warning" | "critical";

export interface NotificationEvent {
  /** Stable key, e.g. "payment.successful". */
  readonly key: string;
  readonly category: string;
  readonly title: string;
  readonly lawfulBasis: LawfulBasis;
  readonly severity: Severity;
  /** The channels this event is *configured* to attempt. Legality is decided per send. */
  readonly channels: readonly Channel[];
}

/**
 * What is true about a recipient, per channel, at the moment of sending.
 *
 *  - `reachable`   there is an address/inbox/token to send to at all.
 *  - `marketingConsent` recorded consent to *marketing* on this channel.
 *  - `suppressed`  a hard opt-out or spam complaint on this channel.
 */
export interface ChannelContext {
  readonly reachable: Readonly<Record<Channel, boolean>>;
  readonly marketingConsent: Readonly<Record<Channel, boolean>>;
  readonly suppressed: Readonly<Record<Channel, boolean>>;
}

export interface ChannelDecision {
  readonly channel: Channel;
  readonly permitted: boolean;
  readonly reason: string;
}

/**
 * Decide, per configured channel, whether this event may be sent.
 *
 * Deterministic and total: every configured channel gets a decision with a
 * reason, so an operator reading the audit can see not just that something was
 * or was not sent but why.
 */
export function routeEvent(event: NotificationEvent, ctx: ChannelContext): ChannelDecision[] {
  return event.channels.map((channel) => decideChannel(event.lawfulBasis, channel, ctx));
}

/** The channels this event may actually be sent on. */
export function permittedChannels(event: NotificationEvent, ctx: ChannelContext): Channel[] {
  return routeEvent(event, ctx)
    .filter((d) => d.permitted)
    .map((d) => d.channel);
}

function decideChannel(
  basis: LawfulBasis,
  channel: Channel,
  ctx: ChannelContext,
): ChannelDecision {
  const deny = (reason: string): ChannelDecision => ({ channel, permitted: false, reason });
  const allow = (reason: string): ChannelDecision => ({ channel, permitted: true, reason });

  if (!ctx.reachable[channel]) return deny(`no ${channel} address on record`);

  // The in-app inbox is a pull surface the recipient opens themselves. It is
  // not a send to them, so consent and suppression do not apply — but security
  // aside, we still never *push* marketing anywhere without consent, and the
  // inbox is where everything is always recorded.
  if (channel === "inapp") return allow("in-app inbox");

  if (basis === "security") {
    // A security notice to the account holder cannot be marketing-suppressed.
    return allow("security notice — delivered to the account holder");
  }

  if (basis === "marketing") {
    // PECR reg. 22: no marketing to an individual by electronic mail of this
    // kind without consent, and SMS/push to an individual is refused outright.
    if (channel === "sms" || channel === "push") {
      return deny(`marketing to an individual is not permitted by ${channel} (PECR reg. 22)`);
    }
    if (ctx.suppressed[channel]) return deny(`recipient has opted out of ${channel}`);
    if (!ctx.marketingConsent[channel]) return deny(`no recorded marketing consent for ${channel}`);
    return allow("marketing — consent recorded");
  }

  // Service / transactional: lawful without marketing consent, but a hard
  // opt-out or complaint still stops it.
  if (ctx.suppressed[channel]) return deny(`recipient has opted out of ${channel}`);
  return allow("service message");
}

/**
 * The catalogue.
 *
 * Lode's own events, grounded in its lifecycle — not a sibling product's
 * enterprise set. Each declares its lawful basis, which is the field that
 * decides everything above. The in-app inbox carries every event; email is
 * added where a recipient would want it off-platform; SMS only on the few
 * security and payment-failure events, and never for marketing.
 */
function event(
  key: string,
  category: string,
  title: string,
  lawfulBasis: LawfulBasis,
  severity: Severity,
  channels: readonly Channel[],
): NotificationEvent {
  return { key, category, title, lawfulBasis, severity, channels };
}

export const NOTIFICATION_CATALOGUE: Readonly<Record<string, NotificationEvent>> = Object.freeze(
  Object.fromEntries(
    [
      // Identity & account
      event("account.registration.received", "Account", "Welcome to Lode", "service", "info", ["inapp", "email"]),
      event("account.verification.successful", "Account", "Your account is verified", "service", "success", ["inapp", "email"]),
      // Login & security — always to the account holder, suppression cannot silence
      event("auth.device.new", "Security", "New device signed in", "security", "warning", ["inapp", "email"]),
      event("auth.login.suspicious", "Security", "Unusual sign-in detected", "security", "critical", ["inapp", "email", "sms"]),
      event("password.changed", "Security", "Your password was changed", "security", "success", ["inapp", "email"]),
      event("mfa.otp_code", "Security", "Your verification code", "security", "info", ["email", "sms"]),
      event("security.account_locked", "Security", "Your account has been locked", "security", "critical", ["inapp", "email", "sms"]),
      // Seller journey
      event("seller.position.ready", "Seller", "Your options are ready", "service", "info", ["inapp", "email"]),
      event("seller.diligence.documents_requested", "Seller", "Documents needed to proceed", "service", "warning", ["inapp", "email"]),
      // Buyer journey
      event("buyer.passport.graded", "Buyer", "Your readiness has been assessed", "service", "info", ["inapp", "email"]),
      event("buyer.reveal.confirmed", "Buyer", "An opportunity has been revealed", "service", "success", ["inapp", "email"]),
      event("buyer.certification.lapsing", "Buyer", "Your certification is expiring", "service", "warning", ["inapp", "email"]),
      // Funding
      event("funding.readiness.scored", "Funding", "Your funding pack has been scored", "service", "info", ["inapp", "email"]),
      event("funding.introduction.made", "Funding", "An introduction has been made", "service", "success", ["inapp", "email"]),
      // Billing — payment failure is the one service event that earns an SMS
      event("payment.successful", "Billing", "Payment received", "service", "success", ["inapp", "email"]),
      event("payment.failed", "Billing", "Your payment failed", "service", "warning", ["inapp", "email", "sms"]),
      event("payout.held", "Billing", "A payout is being held", "service", "info", ["inapp", "email"]),
      // Agents (§12)
      event("agent.decision.recorded", "Agents", "A decision was recorded", "service", "info", ["inapp"]),
      // Legal & privacy
      event("privacy.data_export_ready", "Privacy", "Your data export is ready", "security", "success", ["inapp", "email"]),
      event("privacy.account_deletion_completed", "Privacy", "Your account has been deleted", "security", "info", ["email"]),
      // Marketing — recorded consent only, never auto-enrolled
      event("marketing.newsletter", "Marketing", "The Lode newsletter", "marketing", "info", ["inapp", "email"]),
      event("marketing.opportunity_digest", "Marketing", "New opportunities for you", "marketing", "info", ["inapp", "email"]),
    ].map((e) => [e.key, e]),
  ),
);

/** Look an event up, or undefined for an unknown key. */
export function notificationEvent(key: string): NotificationEvent | undefined {
  return NOTIFICATION_CATALOGUE[key];
}

/** How many catalogue events fire on each channel by default — for the QA surface. */
export function channelCoverage(): Record<Channel, number> {
  const counts: Record<Channel, number> = { inapp: 0, email: 0, sms: 0, push: 0 };
  for (const e of Object.values(NOTIFICATION_CATALOGUE)) {
    for (const c of e.channels) counts[c] += 1;
  }
  return counts;
}

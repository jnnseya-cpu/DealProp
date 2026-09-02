/**
 * Weekly newsletter.
 *
 * COMPLIANCE IS THE ARCHITECTURE HERE, not a footnote. Marketing email to
 * individuals in the UK requires consent under PECR, and every message must
 * carry the sender's identity and a working unsubscribe. So:
 *
 *  - nobody is enrolled without an explicit, recorded opt-in (`consentText`
 *    stores the exact wording they agreed to, which is the evidence a
 *    regulator asks for)
 *  - subscription is double opt-in: an address is not mailable until the owner
 *    of that inbox confirms it, which also stops someone signing up a third
 *    party
 *  - `mailableSubscribers()` is the ONLY way to select recipients, and it
 *    filters to confirmed-and-not-unsubscribed
 *  - seller enquirers are never auto-enrolled. They arrive in probate,
 *    repossession and financial distress; marketing at them would be unlawful
 *    and would contradict the Seller Protection Engine
 *
 * Content is composed from real platform state. A newsletter quoting invented
 * deal counts is the same defect as a screen showing invented numbers.
 */

import { count } from "@shared/format";

/**
 * The exact wording a subscriber agrees to.
 *
 * Stored verbatim on every subscriber record. If a regulator or the subscriber
 * asks what was consented to, the answer must be the words that were on screen
 * at the time — so this constant is the single source for the form label and
 * the stored evidence alike. Changing it changes what future signups agree to,
 * never what past ones did.
 */
export const CONSENT_TEXT =
  "I agree to receive a weekly email from Lode about the platform's features and opportunities. I understand I can unsubscribe at any time using the link in every email.";

export type SubscriberStatus = "pending" | "confirmed" | "unsubscribed" | "bounced";

/** Which side of the marketplace the reader is on. Drives what they are sent. */
export type Audience = "investor" | "funder" | "professional" | "curious";

export interface Subscriber {
  readonly id: string;
  readonly email: string;
  readonly audience: Audience;
  readonly status: SubscriberStatus;
  /** Verbatim wording the subscriber agreed to. Evidence of consent. */
  readonly consentText: string;
  readonly createdAt: string;
  readonly confirmedAt?: string;
  readonly unsubscribedAt?: string;
  readonly confirmToken: string;
  readonly unsubscribeToken: string;
  /** ISO week of the last issue sent, e.g. "2026-W33". Prevents double sends. */
  readonly lastSentWeek?: string;
  /** Where the signup came from, for audit. */
  readonly source: string;
}

/** Only confirmed, still-subscribed addresses may be mailed. */
export function isMailable(s: Subscriber): boolean {
  return s.status === "confirmed";
}

export function mailableSubscribers(all: readonly Subscriber[]): readonly Subscriber[] {
  return all.filter(isMailable);
}

/**
 * Recipients for a given week, excluding anyone already sent this week.
 *
 * The week key is the idempotency key: a cron that fires twice, or a manual
 * re-run after a partial failure, must not mail the same person twice.
 */
export function recipientsForWeek(
  all: readonly Subscriber[],
  weekKey: string,
): readonly Subscriber[] {
  return mailableSubscribers(all).filter((s) => s.lastSentWeek !== weekKey);
}

/**
 * ISO-8601 week key, e.g. "2026-W33".
 *
 * ISO weeks start on Monday and week 1 is the week containing the first
 * Thursday of the year. Deriving this from the date rather than storing a
 * counter means a missed week is skipped, never silently re-sent.
 */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Shift to the Thursday of this week; its year is the ISO week-numbering year.
  const dayNumber = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Links — one definition, used by every issue
// ---------------------------------------------------------------------------

/**
 * Every destination the newsletter can link to.
 *
 * Centralised so a renamed route is fixed in one place rather than in a dozen
 * template strings, and so no issue can ship a link to a page that does not
 * exist.
 */
export const LINKS = {
  home: "/",
  sell: "/sell",
  deals: "/deals",
  newsletter: "/newsletter",
} as const;

export type LinkKey = keyof typeof LINKS;

export function absolute(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}${path.startsWith("/") ? path : `/${path}`}`;
}

/** A feature the newsletter promotes, with the page that demonstrates it. */
export interface FeatureLink {
  readonly title: string;
  readonly blurb: string;
  readonly path: string;
  readonly cta: string;
  /** Audiences this is worth sending to. */
  readonly audiences: readonly Audience[];
}

/**
 * The feature catalogue.
 *
 * Every entry points at a route that exists today. Nothing here advertises
 * something unbuilt — a newsletter that links to a 404 destroys more trust
 * than it earns.
 */
export const FEATURES: readonly FeatureLink[] = [
  {
    title: "Deal Score, computed after tax",
    blurb:
      "Nine components, each carrying the reasoning that produced it. Most tools score a deal before tax and overstate every one of them — worst on the marginal deals where the decision actually matters.",
    path: LINKS.deals,
    cta: "See the pipeline",
    audiences: ["investor", "funder", "professional", "curious"],
  },
  {
    title: "AI Red Team",
    blurb:
      "Nine fixed stress scenarios run against every deal before it reaches capital. Value down, works over, months late, rates up — and the compound tail. Every deal is shocked identically, so you can compare them.",
    path: LINKS.deals,
    cta: "Read a stress table",
    audiences: ["investor", "funder", "professional"],
  },
  {
    title: "True Discount",
    blurb:
      "A property bought 19% below market that costs 19% of its value to transact and repair is not a discount. We show the headline figure and the real one side by side, and the real one is often negative.",
    path: LINKS.deals,
    cta: "Compare the two figures",
    audiences: ["investor", "curious"],
  },
  {
    title: "Capital Stack builder",
    blurb:
      "Assembles third-party funding around a viable transaction so an originator with no cash can still transact — while stating plainly that the money does not disappear, and what the originator actually retains.",
    path: LINKS.deals,
    cta: "See a stack",
    audiences: ["investor", "funder"],
  },
  {
    title: "Strategy Router",
    blurb:
      "Fourteen structures and exits tested against one property, most of them rejected with the reason attached. The rejections are the useful part: knowing why cash purchase fails but assisted sale clears is reusable judgement.",
    path: LINKS.deals,
    cta: "See what got rejected",
    audiences: ["investor", "professional", "curious"],
  },
  {
    title: "Seller Protection Engine",
    blurb:
      "It can block a deal outright — capping the score, forcing a reject, and failing a hard criterion in every match. Our highest-margin seeded deal is blocked, and stays blocked.",
    path: LINKS.deals,
    cta: "See a blocked deal",
    audiences: ["investor", "funder", "professional", "curious"],
  },
  {
    title: "Explainable matching",
    blurb:
      "Buy Boxes and Funding Boxes match on hard criteria that are pass/fail, and every match returns the criteria it met and the ones it missed. A percentage with nothing behind it is not something you can underwrite against.",
    path: LINKS.deals,
    cta: "See the criteria",
    audiences: ["funder", "investor"],
  },
  {
    title: "Close Score and critical path",
    blurb:
      "Once terms are agreed, the OS ranks blockers by how much they actually hold up. A team that chases everything equally chases the wrong thing.",
    path: LINKS.deals,
    cta: "See the blockers",
    audiences: ["professional", "investor", "funder"],
  },
  {
    title: "Solve your property problem",
    blurb:
      "The seller journey asks what is stopping you moving forward before it asks what the property is worth, then returns the routes that genuinely exist — with what each pays, when, and what you give up.",
    path: LINKS.sell,
    cta: "See your options",
    audiences: ["curious", "professional"],
  },
];

export function featuresFor(audience: Audience): readonly FeatureLink[] {
  return FEATURES.filter((f) => f.audiences.includes(audience));
}

// ---------------------------------------------------------------------------
// Issue composition
// ---------------------------------------------------------------------------

/** Real platform state, measured at send time. Never invented. */
export interface PlatformStats {
  readonly totalDeals: number;
  readonly newThisWeek: number;
  readonly bestScore: number;
  readonly blockedCount: number;
  readonly fundingMandates: number;
  readonly buyBoxes: number;
}

export interface IssueContext {
  readonly weekKey: string;
  readonly baseUrl: string;
  readonly stats: PlatformStats;
  readonly subscriber: Subscriber;
  /** Registered sender identity. Required in every marketing email. */
  readonly sender: SenderIdentity;
}

export interface SenderIdentity {
  readonly name: string;
  readonly postalAddress: string;
  readonly replyTo: string;
}

export interface ComposedIssue {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** Every URL in the issue, for link-integrity checks. */
  readonly links: readonly string[];
}

export function composeIssue(ctx: IssueContext): ComposedIssue {
  const { baseUrl, stats, subscriber, sender, weekKey } = ctx;
  const url = (path: string): string => absolute(baseUrl, path);
  const unsubscribeUrl = url(`/newsletter/unsubscribe?token=${subscriber.unsubscribeToken}`);
  const features = featuresFor(subscriber.audience);

  const subject =
    stats.newThisWeek > 0
      ? `${count(stats.newThisWeek, "new opportunity", "new opportunities")} this week, scored after tax`
      : `This week on Lode: ${count(stats.totalDeals, "opportunity", "opportunities")} in the pipeline`;

  const links: string[] = [
    url(LINKS.home),
    url(LINKS.deals),
    url(LINKS.sell),
    ...features.map((f) => url(f.path)),
    unsubscribeUrl,
  ];

  return {
    subject,
    html: renderHtml(ctx, features, unsubscribeUrl),
    text: renderText(ctx, features, unsubscribeUrl),
    links: [...new Set(links)],
  };
}

function statLine(stats: PlatformStats): string {
  return [
    `${count(stats.totalDeals, "opportunity", "opportunities")} in the pipeline`,
    `${count(stats.fundingMandates, "capital mandate")}`,
    `${count(stats.buyBoxes, "Buy Box", "Buy Boxes")}`,
  ].join(" · ");
}

/**
 * Email HTML.
 *
 * Tables and inline styles, deliberately. Email clients do not support the
 * stylesheet the web app uses, and a newsletter that renders correctly only in
 * a browser is broken for most of its readers.
 */
function renderHtml(
  ctx: IssueContext,
  features: readonly FeatureLink[],
  unsubscribeUrl: string,
): string {
  const { baseUrl, stats, sender, weekKey } = ctx;
  const url = (p: string): string => absolute(baseUrl, p);

  const featureRows = features
    .map(
      (f) => `
      <tr><td style="padding:0 0 26px 0;">
        <p style="margin:0 0 6px 0;font:600 17px/1.35 Georgia,serif;color:#e6e6ec;">
          <a href="${url(f.path)}" style="color:#e3c377;text-decoration:none;">${escapeHtml(f.title)}</a>
        </p>
        <p style="margin:0 0 8px 0;font:400 14px/1.6 -apple-system,Segoe UI,sans-serif;color:#9a9aa8;">
          ${escapeHtml(f.blurb)}
        </p>
        <a href="${url(f.path)}" style="font:600 13px/1 -apple-system,Segoe UI,sans-serif;color:#d4a94b;text-decoration:none;">
          ${escapeHtml(f.cta)} &rarr;
        </a>
      </td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(ctx.sender.name)} — ${escapeHtml(weekKey)}</title></head>
<body style="margin:0;padding:0;background:#0a0a0b;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

  <tr><td style="padding:0 0 24px 0;">
    <a href="${url(LINKS.home)}" style="font:600 22px/1 Georgia,serif;color:#e6e6ec;text-decoration:none;">Lode</a>
    <span style="font:400 11px/1 -apple-system,sans-serif;color:#6f6f7d;letter-spacing:.14em;text-transform:uppercase;">&nbsp; Property Deal OS</span>
  </td></tr>

  <tr><td style="padding:0 0 8px 0;border-top:1px solid #2a2a31;"></td></tr>

  <tr><td style="padding:20px 0 6px 0;">
    <p style="margin:0;font:400 11px/1 -apple-system,sans-serif;color:#6f6f7d;letter-spacing:.12em;text-transform:uppercase;">${escapeHtml(weekKey)}</p>
    <p style="margin:8px 0 0 0;font:400 15px/1.6 -apple-system,Segoe UI,sans-serif;color:#c4c4ce;">
      ${escapeHtml(statLine(stats))}.
      ${stats.blockedCount > 0 ? `${escapeHtml(count(stats.blockedCount, "deal"))} blocked by the Seller Protection Engine and not shown to capital.` : ""}
    </p>
    <p style="margin:14px 0 0 0;">
      <a href="${url(LINKS.deals)}" style="display:inline-block;background:#d4a94b;color:#0a0a0b;font:600 14px/1 -apple-system,sans-serif;padding:12px 22px;border-radius:999px;text-decoration:none;">Open the pipeline</a>
    </p>
  </td></tr>

  <tr><td style="padding:28px 0 14px 0;">
    <p style="margin:0;font:400 11px/1 -apple-system,sans-serif;color:#6f6f7d;letter-spacing:.12em;text-transform:uppercase;">What the platform does</p>
  </td></tr>

  ${featureRows}

  <tr><td style="padding:8px 0 24px 0;border-top:1px solid #2a2a31;">
    <p style="margin:18px 0 0 0;font:400 14px/1.6 -apple-system,sans-serif;color:#9a9aa8;">
      Have a property problem rather than a portfolio?
      <a href="${url(LINKS.sell)}" style="color:#e3c377;">Tell us the situation</a> —
      seeing the routes is free, and we will tell you plainly if an ordinary sale would serve you better.
    </p>
  </td></tr>

  <tr><td style="padding:16px 0 0 0;border-top:1px solid #2a2a31;">
    <p style="margin:16px 0 0 0;font:400 12px/1.6 -apple-system,sans-serif;color:#6f6f7d;">
      You are receiving this because you confirmed a subscription at
      <a href="${url(LINKS.newsletter)}" style="color:#9a9aa8;">${escapeHtml(url(LINKS.newsletter))}</a>.
      Figures quoted are engine estimates for screening only and are not advice.
    </p>
    <p style="margin:12px 0 0 0;font:400 12px/1.6 -apple-system,sans-serif;color:#6f6f7d;">
      ${escapeHtml(sender.name)}, ${escapeHtml(sender.postalAddress)}.
      Reply to <a href="mailto:${escapeHtml(sender.replyTo)}" style="color:#9a9aa8;">${escapeHtml(sender.replyTo)}</a>.
    </p>
    <p style="margin:12px 0 0 0;font:400 12px/1.6 -apple-system,sans-serif;color:#9a9aa8;">
      <a href="${unsubscribeUrl}" style="color:#c4c4ce;text-decoration:underline;">Unsubscribe immediately</a>
      — one click, no questions, no sign-in.
    </p>
  </td></tr>

</table></td></tr></table></body></html>`;
}

/** Plain-text alternative. Required: some clients and filters demand it. */
function renderText(
  ctx: IssueContext,
  features: readonly FeatureLink[],
  unsubscribeUrl: string,
): string {
  const { baseUrl, stats, sender, weekKey } = ctx;
  const url = (p: string): string => absolute(baseUrl, p);

  const body = features
    .map((f) => `${f.title}\n${f.blurb}\n${f.cta}: ${url(f.path)}`)
    .join("\n\n");

  return [
    `LODE — PROPERTY DEAL OS (${weekKey})`,
    "",
    `${statLine(stats)}.`,
    stats.blockedCount > 0
      ? `${count(stats.blockedCount, "deal")} blocked by the Seller Protection Engine and not shown to capital.`
      : "",
    "",
    `Open the pipeline: ${url(LINKS.deals)}`,
    "",
    "WHAT THE PLATFORM DOES",
    "",
    body,
    "",
    `Have a property problem rather than a portfolio? ${url(LINKS.sell)}`,
    "",
    "---",
    `You are receiving this because you confirmed a subscription at ${url(LINKS.newsletter)}.`,
    "Figures quoted are engine estimates for screening only and are not advice.",
    `${sender.name}, ${sender.postalAddress}. Reply to ${sender.replyTo}.`,
    `Unsubscribe: ${unsubscribeUrl}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** Escape for HTML text and attribute contexts. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Address validation.
 *
 * Deliberately permissive on shape and strict on the things that cause real
 * harm — header injection via newlines, and absurd lengths. A regex cannot
 * decide deliverability; the confirmation email does that.
 */
export function normaliseEmail(raw: string): string | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 254) return undefined;
  if (/[\r\n\t]/.test(trimmed)) return undefined;
  if (!/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(trimmed)) return undefined;
  return trimmed;
}

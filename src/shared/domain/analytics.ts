/**
 * Analytics: what may be tracked, where, and what may be sent.
 *
 * Meta Pixel and Google Tag are both loaded across this platform, and both are
 * third parties that receive a page URL, title and referrer with every event.
 * That makes two questions load-bearing, and this module is where both are
 * answered once rather than per page.
 *
 * **Where.** The pipeline, the Deal Room, the memorandum and a seller's own
 * result page carry what sellers told us in confidence — reported financial
 * distress, third-party pressure, age band, health and capacity concerns.
 * Health data is special-category personal data under UK GDPR Article 9. A
 * pixel on those pages would send the URL of an identified seller's file to two
 * advertising networks, and a seller's result page is a capability URL, so the
 * URL *is* the credential. Those surfaces are excluded here and the exclusion is
 * a denylist by default: a route is trackable only if it is on the allowlist.
 *
 * **What.** Events carry counts and stages, never content. Not the address, not
 * the postcode, not the price expectation, and — deliberately — not the seller's
 * situation. "Probate" or "divorce" attached to a session that Meta can join to
 * a real identity is information about someone's family life and health, and no
 * conversion report is worth it.
 *
 * Consent is handled separately, in the loader: nothing here runs until the
 * visitor has agreed, because both vendors set non-essential cookies and PECR
 * requires consent before they are set, not after.
 */

/**
 * The event vocabulary.
 *
 * One list, so a name cannot be spelled two ways in two files and split a
 * funnel in half. Names are snake_case because that is what GA4 expects; the
 * Meta side maps them below.
 */
export type AnalyticsEvent =
  /** Any page in the allowlist. Sent by the loader, not by a page. */
  | "page_view"
  // --- Seller funnel -------------------------------------------------------
  | "sell_intake_started"
  | "sell_intake_step_completed"
  | "sell_intake_submitted"
  // --- Audience ------------------------------------------------------------
  | "newsletter_signup_submitted"
  | "newsletter_confirmed"
  | "newsletter_unsubscribed"
  // --- Content -------------------------------------------------------------
  | "blog_post_viewed"
  | "glossary_term_viewed";

/**
 * Deliberately absent: sign-in, investor certification, outbound partner
 * clicks.
 *
 * All three happen only on excluded routes. Sending them anyway would tell Meta
 * and Google that *this browser*, which they can join to a real identity,
 * completed a financial-promotion certification or opened a seller's file —
 * commercially useful and none of their business. Sign-in and certification are
 * already in the audit trail, which is where a conversion involving a named
 * person belongs.
 *
 * An event that can never fire is dead code, so they are not in the vocabulary
 * at all rather than defined and silently dropped.
 */

/**
 * Meta's standard events, where one genuinely fits.
 *
 * Mapped rather than renamed: Meta optimises delivery against its own standard
 * events, and sending everything as a custom event throws that away. Anything
 * absent here is sent to Meta as a custom event under its own name.
 */
export const META_STANDARD_EVENTS: Partial<Record<AnalyticsEvent, string>> = {
  page_view: "PageView",
  sell_intake_started: "InitiateCheckout",
  sell_intake_submitted: "Lead",
  newsletter_signup_submitted: "Lead",
  newsletter_confirmed: "CompleteRegistration",
  blog_post_viewed: "ViewContent",
  glossary_term_viewed: "ViewContent",
};

/**
 * Properties an event may carry.
 *
 * Deliberately narrow and deliberately not `Record<string, unknown>`: an open
 * shape is how a postcode ends up in a pixel payload six months from now
 * because it was convenient at the call site.
 */
export interface EventProperties {
  /** A slug or route already public, e.g. a blog post. Never an identifier. */
  readonly content?: string;
  /** Which step of a multi-step form, 1-based. */
  readonly step?: number;
  /** A bounded, non-identifying category, e.g. a blog topic. */
  readonly category?: string;
}

/**
 * Routes that may be tracked.
 *
 * An allowlist, matched by prefix. Deny-by-default is the only safe direction:
 * a new route added next year is untracked until somebody decides it should be,
 * rather than instrumented by accident because it did not match a denylist.
 */
const TRACKABLE_PREFIXES: readonly string[] = [
  "/", // exact only; see isTrackableRoute
  "/sell",
  "/blog",
  "/glossary",
  "/newsletter",
  "/offline",
];

/**
 * Routes that must never be tracked, whatever the allowlist says.
 *
 * Checked first and unconditionally. `/sell` is trackable but `/sell/{token}`
 * is a seller's own result page, and its URL is the credential that opens it.
 */
const NEVER_TRACK_PREFIXES: readonly string[] = [
  "/deals",
  "/invest",
  "/capital",
  "/operator",
  "/account",
  "/api",
  /*
   * The free appraisal, and this one is not obvious.
   *
   * Its whole design is that the deal lives in the query string, so a result
   * has a URL somebody can send to their business partner. Both vendors read
   * `location.href` themselves for a page view — we do not hand it to them and
   * we cannot stop them taking it — so allowlisting this route would ship a
   * visitor's purchase price, their refurbishment budget and what they think
   * the property is worth to an ad network, on a page that exists precisely
   * because it asks for no account and stores nothing.
   *
   * The click through to it is measurable from the page it was clicked on,
   * which carries no figures. That is the measurement worth having.
   */
  "/appraise",
];

/** True where a pixel may fire on this path. */
export function isTrackableRoute(pathname: string): boolean {
  const path = normalisePath(pathname);

  for (const prefix of NEVER_TRACK_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return false;
  }

  // A seller's result page. `/sell` is the public form; anything below it
  // identifies one seller and their answers.
  if (path.startsWith("/sell/")) return false;

  if (path === "/") return true;
  return TRACKABLE_PREFIXES.some(
    (prefix) => prefix !== "/" && (path === prefix || path.startsWith(`${prefix}/`)),
  );
}

function normalisePath(pathname: string): string {
  // Query and hash are dropped before any comparison: a token in a query string
  // would otherwise decide the answer and then be sent anyway.
  const path = pathname.split(/[?#]/)[0] ?? "/";
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

/**
 * The path as it may be reported.
 *
 * Even on a trackable route the raw path can carry more than intended, so this
 * is the single place a URL is prepared for a third party. Query strings and
 * fragments go entirely — `?next=/deals/enq-abc` on the sign-in page would
 * otherwise hand an operator route to two advertising networks.
 */
export function reportablePath(pathname: string): string | undefined {
  const path = normalisePath(pathname);
  return isTrackableRoute(path) ? path : undefined;
}

/**
 * Whether an event may be sent at all.
 *
 * Belt and braces with the route check: an event fired from a component that
 * happens to render on an excluded page must not escape because the component
 * did not know where it was.
 */
export function mayTrack(event: AnalyticsEvent, pathname: string): boolean {
  return isTrackableRoute(pathname) && KNOWN_EVENTS.has(event);
}

const KNOWN_EVENTS = new Set<AnalyticsEvent>([
  "page_view",
  "sell_intake_started",
  "sell_intake_step_completed",
  "sell_intake_submitted",
  "newsletter_signup_submitted",
  "newsletter_confirmed",
  "newsletter_unsubscribed",
  "blog_post_viewed",
  "glossary_term_viewed",
]);

/**
 * Strip anything that should not leave the building.
 *
 * The property shape is already narrow, so this is the second gate rather than
 * the first: it drops empty values, caps length so a stray body of text cannot
 * be posted through a label, and refuses anything that looks like an
 * identifier, an email address or a UK postcode.
 */
export function sanitiseProperties(properties: EventProperties = {}): EventProperties {
  const clean: {
    content?: string;
    step?: number;
    category?: string;
  } = {};

  const text = (value: string | undefined): string | undefined => {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (trimmed === "" || trimmed.length > 120) return undefined;
    if (looksIdentifying(trimmed)) return undefined;
    return trimmed;
  };

  const content = text(properties.content);
  if (content !== undefined) clean.content = content;

  const category = text(properties.category);
  if (category !== undefined) clean.category = category;

  if (
    properties.step !== undefined &&
    Number.isInteger(properties.step) &&
    properties.step > 0 &&
    properties.step < 100
  ) {
    clean.step = properties.step;
  }

  return clean;
}

/**
 * An email address, a UK postcode, or one of our own record identifiers.
 *
 * The identifier rule is deliberately narrow. A first attempt flagged anything
 * beginning `deal-`, which caught the topic name "deal-analysis" and the public
 * blog slug "deal-breakdown-erdington-b23" — both already in the sitemap, and
 * both exactly what a content report is for. What actually needs blocking is a
 * capability token or a record number, so that is what this matches.
 */
function looksIdentifying(value: string): boolean {
  if (value.includes("@")) return true;
  // A UK postcode plus a page view is enough to identify a household.
  if (/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(value)) return true;
  // Capability tokens: enq-, acc-, buy-, fund- followed by a long random tail.
  if (/\b(enq|acc|buy|fund)-[A-Za-z0-9_-]{8,}/.test(value)) return true;
  // Seeded record numbers, e.g. deal-0001. Not "deal-breakdown-…".
  if (/\bdeal-\d{3,}/.test(value)) return true;
  return false;
}

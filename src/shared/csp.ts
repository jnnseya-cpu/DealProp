/**
 * The Content-Security-Policy, in two halves, and why it is two.
 *
 * A nonce must be minted per request. A statically prerendered page is one
 * piece of HTML served to everybody, so it cannot carry one — and reading a
 * per-request value inside a component is exactly what makes a page dynamic.
 * The landing page is on a five-minute revalidate because its unbounded deal
 * scan is only affordable cached; making it dynamic to gain a nonce would
 * trade a real availability property for a theoretical security one.
 *
 * So the public pages get `baselineCsp()`, which closes every injection
 * primitive that does not need a nonce, and the operator and account surfaces
 * get `noncedCsp()`, which is strictly stronger and costs nothing there
 * because those pages are dynamic already. The pages holding seller screening
 * answers get the strong policy; the pages holding nothing keep the caching.
 *
 * Both are built here so there is one place a directive is written down. A
 * second copy in `next.config.mjs` would have drifted the first time somebody
 * added an origin.
 */

/**
 * Where a vendor tag may be fetched from, if one is ever loaded.
 *
 * Listed unconditionally rather than switched on whether an ID is configured,
 * because a header assembled from runtime configuration is a header that ends
 * up wrong. `analytics.ts` is still the thing that decides whether a tag loads
 * at all, on a deny-by-default route allowlist; this only bounds where it
 * could load from if it does.
 */
const ANALYTICS_SCRIPT = ["https://www.googletagmanager.com", "https://connect.facebook.net"];

const ANALYTICS_CONNECT = [
  "https://www.google-analytics.com",
  "https://region1.google-analytics.com",
  "https://www.googletagmanager.com",
  "https://connect.facebook.net",
  "https://www.facebook.com",
];

/** Everything except `script-src`, which is the only directive that differs. */
function common(): readonly string[] {
  return [
    "default-src 'self'",
    // Tailwind ships a stylesheet; the inline styles are Next's own.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${ANALYTICS_CONNECT.join(" ")}`,
    // No plugins, ever. Free, and closes a whole class.
    "object-src 'none'",
    // Stops an injected <base> rewriting every relative URL on the page.
    "base-uri 'none'",
    // Nothing here is meant to be embedded. Duplicates X-Frame-Options for the
    // browsers that honour only one of the two.
    "frame-ancestors 'none'",
    "frame-src 'none'",
    // A form posting somewhere else is how an injected form harvests a
    // password. Server actions post to this origin.
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "upgrade-insecure-requests",
  ];
}

/**
 * The public policy.
 *
 * `'unsafe-inline'` in `script-src` is the one directive static rendering
 * costs: Next's App Router emits inline bootstrap scripts carrying the RSC
 * payload, they cannot carry a per-request nonce on a prerendered page, and
 * their content varies per page so a hash cannot go in a static header. It is
 * stated here rather than hidden, and it is why the pages that actually hold
 * personal data do not use this policy.
 *
 * Our own inline scripts are all `application/ld+json`, which is a data block
 * rather than executable script and is not governed by `script-src` at all.
 * Those are protected by escaping at the serialiser — see `jsonLdScript()`.
 */
export function baselineCsp(): string {
  return [`script-src 'self' 'unsafe-inline' ${ANALYTICS_SCRIPT.join(" ")}`, ...common()].join(
    "; ",
  );
}

/**
 * The policy for a page that carries personal data.
 *
 * `'strict-dynamic'` means a script the nonce vouches for may load others, and
 * that host allowlists are ignored by browsers that support it — which is what
 * makes this materially stronger rather than differently worded. No analytics
 * origin appears, because the route allowlist will not load a tag on any of
 * these routes and a policy permitting what the allowlist refuses is a policy
 * that outlives the allowlist.
 */
export function noncedCsp(nonce: string): string {
  return [`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`, ...common()].join("; ");
}

/**
 * Paths that hold personal data and therefore get the nonce.
 *
 * The same list as the middleware's auth matcher, and deliberately so: the
 * pages worth authenticating are the pages worth the stronger policy. Kept as
 * data rather than as a regex so both can be read at a glance.
 */
export const PERSONAL_DATA_PREFIXES: readonly string[] = [
  "/deals",
  "/invest",
  "/opportunities",
  "/portfolio",
  "/capital",
  "/account",
  "/operator",
  // A seller's own result page is a capability URL carrying their situation.
  // Not behind the auth gate by design; every bit as sensitive.
  "/sell/",
  // A funder's time-limited view of one deal.
  "/dataroom/",
];

export function carriesPersonalData(pathname: string): boolean {
  return PERSONAL_DATA_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
  );
}

/**
 * Security headers.
 *
 * Applied to every response. These are the ones that cost nothing and close
 * real classes of attack against a site that renders seller screening answers
 * behind a session cookie.
 *
 * The Content-Security-Policy is NOT here. It lives in `src/shared/csp.ts`
 * and is applied by `src/middleware.ts`, because it needs a per-request nonce
 * on the pages that carry personal data and a static header cannot mint one.
 *
 * It was briefly in both places, and the two immediately disagreed — the
 * redirect from a gated route served one policy and the page it redirected to
 * served the other. That is the ordinary fate of a value written down twice,
 * and it is why the directives have one home.
 *
 * The split itself is deliberate.
 *
 * A nonce has to be minted per request. A statically prerendered page is one
 * piece of HTML served to everybody, so it cannot carry one — and reading a
 * per-request header inside a component is what makes a page dynamic. The
 * landing page is on a five-minute revalidate precisely because its unbounded
 * deal scan is only affordable cached; making it dynamic to gain a nonce would
 * trade a real availability property for a theoretical one.
 *
 * So: this baseline applies everywhere and closes the injection primitives
 * that do not need a nonce — no objects, no base tag rewriting, no framing, no
 * form posting off-origin, and a default-src of 'self'. `script-src` here has
 * to tolerate Next's own inline bootstrap, which is the honest cost of static
 * rendering and is stated rather than hidden.
 *
 * `src/middleware.ts` then replaces it with a nonce-based policy on the
 * operator and account surfaces — the pages that carry seller screening
 * answers, which are already dynamic, so the nonce costs nothing there. The
 * pages with the data get the strong policy; the pages without it keep the
 * caching.
 *
 * Our own inline scripts are all `application/ld+json`, which is a data block
 * rather than executable script and is not governed by `script-src` at all.
 * They are protected by escaping at the serialiser — see `jsonLdScript()`.
 */
const securityHeaders = [
  // Stop the browser guessing a content type and executing an upload as script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // No framing at all: nothing here is meant to be embedded, and clickjacking
  // an operator surface would be clickjacking a page of personal data.
  { key: "X-Frame-Options", value: "DENY" },
  // Send the origin to other sites, the full path only to ourselves. Seller
  // result pages are capability URLs and must never leak in a referer.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here needs a camera, a microphone or a location.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Two years, subdomains included. Only meaningful over HTTPS, which the
  // preflight requires before go-live.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Emit a self-contained server at `.next/standalone`.
   *
   * Next traces the modules the server actually reaches and copies them, so the
   * runtime image carries no `node_modules` tree, no toolchain and none of the
   * dev dependencies — the container that serves the app cannot run `tsx`,
   * `playwright` or a test. Vercel does not need this and is unaffected by it;
   * every other host does, and `docs/GO-LIVE.md` claims any host works, so this
   * is what makes that true.
   */
  output: "standalone",
  /**
   * Never trace the file store into the build output.
   *
   * `next build` renders pages, rendering a page reads the store, and with no
   * `DATABASE_URL` that creates `.data/lode.json` — which tracing then copied
   * into `.next/standalone`, so the deployable artefact carried a full copy of
   * whatever was in the developer's store, seller records included, into
   * whatever registry the image was pushed to. Caught by building it and
   * looking. The runtime never wants a build-time store either way: on a real
   * deployment the answer is `DATABASE_URL`.
   */
  outputFileTracingExcludes: { "*": [".data/**"] },
  /**
   * The image optimiser is off, because nothing uses it.
   *
   * `next/image` is imported nowhere in this codebase — the only images are
   * the PWA icons and splashes, which are pre-generated PNGs served straight
   * from `public/`. Leaving `/_next/image` enabled therefore bought nothing
   * and left a request-path endpoint that decodes attacker-supplied images
   * through libvips and libheif, which is where the critical unauthenticated
   * RCE in 15.5.23 lived and where the outstanding sharp advisories live now.
   *
   * An endpoint that no page calls and every visitor can reach is the cheapest
   * possible thing to remove.
   */
  images: { unoptimized: true },
  reactStrictMode: true,
  // Never leak the framework version to a scanner.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

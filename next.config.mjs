/**
 * Security headers.
 *
 * Applied to every response. These are the ones that cost nothing and close
 * real classes of attack against a site that renders seller screening answers
 * behind a session cookie.
 *
 * There is deliberately no Content-Security-Policy here yet. A CSP that is
 * wrong is worse than none — it either blocks the app's own scripts or is
 * loosened with 'unsafe-inline' until it stops meaning anything. Next's
 * framework and the JSON-LD blocks need a nonce-based policy to be done
 * properly, and that belongs in its own change with its own verification.
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
  reactStrictMode: true,
  // Never leak the framework version to a scanner.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

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
  reactStrictMode: true,
  // Never leak the framework version to a scanner.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

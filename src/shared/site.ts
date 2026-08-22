/**
 * The site's own identity, as far as it can be known without configuration.
 *
 * The pure half lives here and the environment read lives in
 * `@backend/site`, because `src/shared` may not read `process.env` — a figure
 * or a URL that changes with configuration is not something a caller can
 * reproduce from what they were given.
 */

export const SITE_NAME = "Lode";

/** Used when nothing is configured. Obvious rather than plausible. */
export const LOCAL_SITE_URL = "http://localhost:3000";

/**
 * Normalise a configured origin: trimmed, no trailing slash.
 *
 * Canonical URLs and structured data need an absolute origin, and a trailing
 * slash produces `https://example.com//blog` — which crawlers treat as a
 * different URL from the one every link points at.
 */
export function normaliseSiteUrl(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") return LOCAL_SITE_URL;
  return raw.trim().replace(/\/+$/, "");
}

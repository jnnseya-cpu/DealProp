import { normaliseSiteUrl } from "@shared/site";

/**
 * The configured site origin.
 *
 * Reads `NEXT_PUBLIC_SITE_URL`, the variable the newsletter's confirm and
 * unsubscribe links already use, rather than introducing a second source of
 * truth that can disagree with it. Server-side only: this is the half of
 * `@shared/site` that touches the environment.
 */
export function siteUrl(): string {
  return normaliseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
}

export { SITE_NAME } from "@shared/site";

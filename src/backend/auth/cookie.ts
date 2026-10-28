/**
 * The cookie's domain, so one session spans the apex and `www`.
 *
 * Without this a cookie set on `www.lodeprop.com` is not sent to `lodeprop.com`
 * (and vice versa), so the apex→www redirect silently logs a signed-in person
 * out the moment they navigate. Derived from the configured site URL and
 * stripped of a leading `www.`, so the domain is the registrable one and covers
 * both. Returns nothing for localhost or a bare IP, which cannot take a domain
 * cookie — there the host-only cookie is correct.
 *
 * Shared by sign-in and sign-up so the session cookie is scoped identically
 * however it was minted; one source of truth for a rule that is silent and
 * total when it is wrong.
 */
export function cookieScope(): { readonly domain?: string } {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (raw === undefined || raw === "") return {};
  try {
    const host = new URL(raw).hostname;
    if (host === "localhost" || /^[0-9.]+$/.test(host)) return {};
    return { domain: host.replace(/^www\./, "") };
  } catch {
    return {};
  }
}

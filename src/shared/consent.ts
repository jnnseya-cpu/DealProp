/**
 * Cookie consent.
 *
 * Meta Pixel and Google Tag both set non-essential cookies, so under PECR
 * regulation 6 they may only load once the visitor has agreed — before, not
 * after. That makes consent a precondition of the script tag existing, not a
 * banner shown alongside it.
 *
 * Three states, and "unknown" is not "yes". A visitor who has never answered is
 * treated exactly like one who declined.
 */

export type ConsentState = "granted" | "denied" | "unknown";

export const CONSENT_COOKIE = "lode_consent";

/**
 * How long a stored answer lasts.
 *
 * Six months, the ICO's own guidance for re-asking. An answer kept for years is
 * not a current one.
 */
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 182;

/** The text shown, kept here so the banner and any record of it agree. */
export const CONSENT_TEXT =
  "We use Meta and Google analytics cookies to see which pages bring people here. They are not used on any page showing a seller's own information. You can decline and the site works exactly the same.";

export function parseConsent(raw: string | undefined): ConsentState {
  if (raw === "granted") return "granted";
  if (raw === "denied") return "denied";
  // Anything unrecognised — absent, corrupted, tampered with — is not consent.
  return "unknown";
}

export function consentAllowsAnalytics(state: ConsentState): boolean {
  return state === "granted";
}

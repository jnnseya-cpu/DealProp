/**
 * The seller's consent at the point of enquiry.
 *
 * The inbound funnel is lawful precisely because the seller initiates it, but
 * "they pressed the button" is not, on its own, a record of anything. Two
 * things have to be true and recorded at submission, and before this they were
 * only implied:
 *
 *  - **Transparency.** Under UK GDPR Article 13 a person handing over their
 *    information has to be told what happens to it, at the time they hand it
 *    over. So the enquiry carries the version of the privacy notice that was
 *    shown, not a bare boolean — if the notice changes, an old consent cannot
 *    silently claim the new terms.
 *  - **Standing.** The person has to be the owner, or authorised to explore a
 *    sale. This is NOT the anti-money-laundering check that `sellerDueDiligence`
 *    does and the reveal waits on — nobody has verified anything yet. It is the
 *    seller's own affirmation, recorded so that a later check has something to
 *    check against rather than starting from nothing.
 *
 * Neither field is personal data: a boolean, a version and a timestamp identify
 * nobody, so this is not sealed. The circumstances a seller describes are, and
 * those live on `seller` and are encrypted there.
 */

/**
 * The version of the privacy notice shown at enquiry.
 *
 * A date, bumped whenever the notice content below changes, so a stored consent
 * always says which words the seller actually agreed to. Tying the version to
 * the content in one file is the point — a version that can drift from the text
 * it names is worse than no version at all.
 */
export const PRIVACY_NOTICE_VERSION = "2026-10-21";

/**
 * What the seller is told, in plain words, at the moment they submit.
 *
 * Held here rather than written into the form so the version above pins the
 * exact text, and so the same points can be shown anywhere the notice is.
 */
export const PRIVACY_NOTICE_POINTS: readonly string[] = [
  "We use what you tell us to show you the routes that could solve your situation, and for nothing else.",
  "Your situation, your figures and the safeguards raised for you are private to you and the people working on your enquiry. We never sell your information, and no buyer or investor sees it without a separate check.",
  "You can ask us to show you what we hold, correct it, or delete it, at any time.",
  "This is an enquiry, not an agreement. Nothing you see here is an offer, and you are free to walk away.",
];

export interface SellerEnquiryConsent {
  /** ISO-8601 moment the enquiry was submitted. */
  readonly acknowledgedAt: string;
  /** The privacy-notice version shown, so an old consent cannot claim new terms. */
  readonly privacyNoticeVersion: string;
  /** The seller affirmed they own the property or are authorised to sell it. */
  readonly ownerAffirmed: boolean;
}

export class ConsentNotGiven extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "ConsentNotGiven";
  }
}

/**
 * Build the consent record, or refuse the enquiry.
 *
 * Both affirmations are required. An enquiry that reaches the server without
 * them is not processed — the alternative is storing a person's circumstances
 * with no lawful record of why we hold them, which is the exposure the record
 * exists to prevent. The form makes both mandatory; this is the server making
 * sure, because a client control is not a control.
 */
export function recordEnquiryConsent(
  input: { readonly ownerAffirmed: boolean; readonly privacyAcknowledged: boolean },
  now: Date = new Date(),
): SellerEnquiryConsent {
  if (!input.privacyAcknowledged) {
    throw new ConsentNotGiven("The privacy notice was not acknowledged.");
  }
  if (!input.ownerAffirmed) {
    throw new ConsentNotGiven("The seller did not affirm they may sell the property.");
  }
  return {
    acknowledgedAt: now.toISOString(),
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    ownerAffirmed: true,
  };
}

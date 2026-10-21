import { describe, expect, it } from "vitest";
import {
  ConsentNotGiven,
  PRIVACY_NOTICE_POINTS,
  PRIVACY_NOTICE_VERSION,
  recordEnquiryConsent,
} from "@shared/domain/sellerConsent";

/**
 * The enquiry cannot be processed without a record of why we may hold it.
 * Both affirmations are required, and the stored consent names the version of
 * the notice the seller actually saw.
 */
describe("seller enquiry consent", () => {
  const NOW = new Date("2026-10-21T09:00:00.000Z");

  it("records the consent, stamping the privacy-notice version shown", () => {
    const consent = recordEnquiryConsent({ ownerAffirmed: true, privacyAcknowledged: true }, NOW);
    expect(consent.ownerAffirmed).toBe(true);
    expect(consent.privacyNoticeVersion).toBe(PRIVACY_NOTICE_VERSION);
    expect(consent.acknowledgedAt).toBe(NOW.toISOString());
  });

  it("refuses the enquiry when the privacy notice was not acknowledged", () => {
    expect(() => recordEnquiryConsent({ ownerAffirmed: true, privacyAcknowledged: false }, NOW)).toThrow(
      ConsentNotGiven,
    );
  });

  it("refuses the enquiry when the seller did not affirm they may sell", () => {
    expect(() => recordEnquiryConsent({ ownerAffirmed: false, privacyAcknowledged: true }, NOW)).toThrow(
      ConsentNotGiven,
    );
  });

  it("publishes the notice points so the version pins real text", () => {
    expect(PRIVACY_NOTICE_POINTS.length).toBeGreaterThanOrEqual(3);
    for (const point of PRIVACY_NOTICE_POINTS) expect(point.length).toBeGreaterThan(20);
  });
});

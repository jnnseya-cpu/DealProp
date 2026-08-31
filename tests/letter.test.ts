import { describe, expect, it } from "vitest";
import {
  manualTransport,
  postalKey,
  providerTransport,
  resolveLetterTransport,
} from "@backend/outreach/letter";
import { outreachEligibility, type Candidate, type OutreachContext } from "@shared/domain/outreach";

/**
 * The letter channel.
 *
 * PECR governs electronic mail, so writing to a named individual by email
 * without consent is unlawful and writing to them by post is not. A gate that
 * refused individuals regardless of channel got the law wrong in the safe
 * direction — which sounds harmless until it means the only lawful route to a
 * homeowner is the one the platform will not take.
 */

const NOW = new Date("2026-08-26T11:00:00Z");

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "cand-1",
    organisationName: "Jane Smith",
    recipientType: "individual",
    postalAddress: {
      value: "12 Elsewhere Road, Birmingham B23 6TT",
      provenance: { sourceKey: "land-registry-title", observedAt: "2026-08-25", inferred: false },
    },
    status: "VERIFIED",
    verifiedAt: "2026-08-25T00:00:00.000Z",
    warningFlags: [],
    optedOut: false,
    doNotContact: false,
    ...overrides,
  };
}

function context(overrides: Partial<OutreachContext> = {}): OutreachContext {
  return {
    channel: "letter",
    consentRecorded: false,
    softOptInApplies: false,
    complianceApproved: false,
    promotionApproved: false,
    alreadyContactedForDeal: false,
    dealDisclosureConsent: false,
    mpsScreened: true,
    privacyNoticeIncluded: true,
    legitimateInterestsRecorded: true,
    now: NOW,
    ...overrides,
  };
}

describe("a letter to a named individual", () => {
  it("is allowed where the three things that make it lawful are done", () => {
    const decision = outreachEligibility(candidate(), "mandate-enquiry", context());
    expect(decision.decision).toBe("SEND_ALLOWED");
    expect(decision.maySend).toBe(true);
  });

  it("is still refused by email without consent", () => {
    // The channel is what changed, not the rule.
    const decision = outreachEligibility(
      candidate({
        publishedEmail: {
          value: "jane@example.com",
          provenance: { sourceKey: "x", observedAt: "2026-08-25", inferred: false },
        },
      }),
      "mandate-enquiry",
      context({ channel: "email" }),
    );
    expect(decision.decision).toBe("CONSENT_REQUIRED");
    expect(decision.blockers.join(" ")).toContain("by post");
  });

  it("is held where the address has not been screened against the MPS", () => {
    const decision = outreachEligibility(candidate(), "mandate-enquiry", context({ mpsScreened: false }));
    expect(decision.decision).toBe("COMPLIANCE_APPROVAL_REQUIRED");
    expect(decision.blockers.join(" ")).toContain("Mailing Preference Service");
  });

  it("is held without a privacy notice", () => {
    const decision = outreachEligibility(
      candidate(),
      "mandate-enquiry",
      context({ privacyNoticeIncluded: false }),
    );
    expect(decision.maySend).toBe(false);
    expect(decision.blockers.join(" ")).toContain("where the address came from");
  });

  it("is held without a recorded legitimate-interests assessment", () => {
    // Relying on it without doing it is relying on nothing.
    const decision = outreachEligibility(
      candidate(),
      "mandate-enquiry",
      context({ legitimateInterestsRecorded: false }),
    );
    expect(decision.maySend).toBe(false);
    expect(decision.blockers.join(" ")).toContain("legitimate-interests");
  });

  it("is refused where there is no postal address on record", () => {
    const decision = outreachEligibility(
      candidate({ postalAddress: undefined }),
      "mandate-enquiry",
      context(),
    );
    expect(decision.decision).toBe("DO_NOT_CONTACT");
    expect(decision.reason).toContain("Nothing is inferred");
  });

  it("is refused where the address was inferred rather than read", () => {
    const decision = outreachEligibility(
      candidate({
        postalAddress: {
          value: "12 Elsewhere Road",
          provenance: { sourceKey: "guess", observedAt: "2026-08-25", inferred: true },
        },
      }),
      "mandate-enquiry",
      context(),
    );
    expect(decision.decision).toBe("DO_NOT_CONTACT");
  });

  it("still honours an opt-out, whatever the channel", () => {
    expect(
      outreachEligibility(candidate({ optedOut: true }), "mandate-enquiry", context()).decision,
    ).toBe("DO_NOT_CONTACT");
  });

  it("does not need the letter prerequisites for a company", () => {
    const decision = outreachEligibility(
      candidate({ recipientType: "limited-company" }),
      "mandate-enquiry",
      context({ mpsScreened: false, privacyNoticeIncluded: false, legitimateInterestsRecorded: false }),
    );
    expect(decision.decision).toBe("SEND_ALLOWED");
  });
});

describe("posting it", () => {
  const letter = { to: "Jane Smith", address: "12 Elsewhere Road", subject: "s", body: "b" };

  it("queues rather than pretending, with no provider configured", () => {
    expect(resolveLetterTransport({}).name).toBe("manual");
    return manualTransport.post(letter).then((result) => {
      expect(result.outcome).toBe("queued-for-post");
      expect(result.reason).toContain("nothing here has sent it");
    });
  });

  it("needs all three settings before it uses a provider", () => {
    expect(resolveLetterTransport({ LETTER_API_URL: "x", LETTER_API_KEY: "y" }).name).toBe("manual");
    expect(
      resolveLetterTransport({
        LETTER_API_URL: "https://x.example",
        LETTER_API_KEY: "y",
        LETTER_SENDER_ADDRESS: "1 Sender St",
      }).name,
    ).toBe("provider");
  });

  it("dispatches through a configured provider", async () => {
    const transport = providerTransport({
      url: "https://print.example/send",
      apiKey: "k",
      sender: "1 Sender St",
      transport: (async () =>
        new Response(JSON.stringify({ id: "job-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch,
    });
    const result = await transport.post(letter);
    expect(result.outcome).toBe("dispatched");
    expect(result.reference).toBe("job-1");
  });

  it("reports a provider failure rather than losing the letter", async () => {
    const transport = providerTransport({
      url: "https://print.example/send",
      apiKey: "k",
      sender: "1 Sender St",
      transport: (async () => new Response("", { status: 500 })) as unknown as typeof fetch,
    });
    expect((await transport.post(letter)).outcome).toBe("failed");
  });
});

describe("suppressing by address", () => {
  it("matches the same address written differently", () => {
    // Somebody who asked to be left alone asked once.
    expect(postalKey("12 Elsewhere Road, Birmingham, B23 6TT")).toBe(
      postalKey("12 elsewhere rd. birmingham b236tt"),
    );
  });

  it("does not collapse two different houses on one street", () => {
    expect(postalKey("12 Elsewhere Road, B23 6TT")).not.toBe(postalKey("14 Elsewhere Road, B23 6TT"));
  });

  it("does not collapse two postcodes", () => {
    expect(postalKey("12 Elsewhere Road, B23 6TT")).not.toBe(postalKey("12 Elsewhere Road, B24 9AA"));
  });

  it("errs towards writing again rather than suppressing the wrong person", () => {
    // With no postcode to lean on the key is strict, so a near-miss does not
    // silently suppress somebody else.
    expect(postalKey("Rose Cottage, The Green")).not.toBe(postalKey("Rose Cottage The Green, Devon"));
  });
});

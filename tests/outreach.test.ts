import { describe, expect, it } from "vitest";
import {
  checkNeutralEnquiry,
  classifyReply,
  outreachEligibility,
  reconcile,
  verificationIsCurrent,
  type Candidate,
  type OutreachContext,
} from "@shared/domain/outreach";

/**
 * These are the tests that matter most in this file, and they are the refusals.
 * A failure here is the platform emailing thousands of organisations unlawfully,
 * in the operator's name, on its own initiative.
 */

const NOW = new Date("2026-08-25T12:00:00.000Z");

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "cand-1",
    organisationName: "Example Bridging Ltd",
    recipientType: "limited-company",
    domain: {
      value: "examplebridging.co.uk",
      provenance: { sourceKey: "companies-house", observedAt: "2026-08-20", inferred: false },
    },
    publishedEmail: {
      value: "enquiries@examplebridging.co.uk",
      provenance: { sourceKey: "own-website", observedAt: "2026-08-20", inferred: false },
    },
    status: "VERIFIED",
    verifiedAt: "2026-08-20T00:00:00.000Z",
    warningFlags: [],
    optedOut: false,
    doNotContact: false,
    ...overrides,
  };
}

function context(overrides: Partial<OutreachContext> = {}): OutreachContext {
  return {
    channel: "email",
    consentRecorded: false,
    softOptInApplies: false,
    complianceApproved: false,
    promotionApproved: false,
    alreadyContactedForDeal: false,
    dealDisclosureConsent: false,
    now: NOW,
    ...overrides,
  };
}

describe("who must never be written to", () => {
  it("refuses an address nobody verified", () => {
    // Acceptance test 1: an unverified or guessed email cannot be sent to.
    const decision = outreachEligibility(
      candidate({ status: "UNVERIFIED" }),
      "mandate-enquiry",
      context(),
    );
    expect(decision.decision).toBe("DO_NOT_CONTACT");
    expect(decision.maySend).toBe(false);
  });

  it("refuses an address a model inferred rather than a source published", () => {
    // The single most likely thing an extraction agent invents.
    const guessed = candidate({
      publishedEmail: {
        value: "firstname.lastname@examplebridging.co.uk",
        provenance: { sourceKey: "model", observedAt: "2026-08-20", inferred: true },
      },
    });
    expect(outreachEligibility(guessed, "mandate-enquiry", context()).maySend).toBe(false);
  });

  it("refuses a candidate with no contact address at all", () => {
    const decision = outreachEligibility(
      candidate({ publishedEmail: undefined }),
      "mandate-enquiry",
      context(),
    );
    expect(decision.decision).toBe("DO_NOT_CONTACT");
  });

  it("refuses on a warning-list match and opens a case instead", () => {
    // Acceptance test 2.
    const flagged = candidate({ warningFlags: ["FCA warning list"] });
    const decision = outreachEligibility(flagged, "mandate-enquiry", context());
    expect(decision.decision).toBe("DO_NOT_CONTACT");
    expect(decision.reason).toContain("compliance case");
  });

  it("refuses where discovered details conflict with the official record", () => {
    // The signature of a cloned firm. Picking the newer value picks the clone.
    expect(outreachEligibility(candidate({ status: "CONFLICTING" }), "mandate-enquiry", context()).maySend)
      .toBe(false);
  });

  it("honours an opt-out across every deal and campaign", () => {
    // Acceptance test 4.
    const decision = outreachEligibility(candidate({ optedOut: true }), "mandate-enquiry", context());
    expect(decision.decision).toBe("DO_NOT_CONTACT");
    expect(decision.reason).toContain("every deal");
  });

  it("will not send on stale verification, only draft", () => {
    const stale = candidate({ verifiedAt: "2026-01-01T00:00:00.000Z" });
    const decision = outreachEligibility(stale, "mandate-enquiry", context());
    expect(decision.decision).toBe("DRAFT_ONLY");
    expect(verificationIsCurrent(stale, NOW)).toBe(false);
  });
});

describe("who may be written to, and on what terms", () => {
  it("allows a neutral enquiry to a verified corporate recipient", () => {
    const decision = outreachEligibility(candidate(), "mandate-enquiry", context());
    expect(decision.decision).toBe("SEND_ALLOWED");
    expect(decision.maySend).toBe(true);
  });

  it("requires consent for a sole trader", () => {
    // Acceptance test 3.
    const decision = outreachEligibility(
      candidate({ recipientType: "sole-trader" }),
      "mandate-enquiry",
      context(),
    );
    expect(decision.decision).toBe("CONSENT_REQUIRED");
  });

  it("requires consent for an individual and an ordinary partnership", () => {
    for (const type of ["individual", "partnership"] as const) {
      expect(
        outreachEligibility(candidate({ recipientType: type }), "mandate-enquiry", context()).decision,
        type,
      ).toBe("CONSENT_REQUIRED");
    }
  });

  it("treats an unknown recipient type as an individual, not as a company", () => {
    // Getting this the other way round is how a lawful B2B campaign becomes an
    // unlawful one.
    const decision = outreachEligibility(
      candidate({ recipientType: "unknown" }),
      "mandate-enquiry",
      context(),
    );
    expect(decision.decision).toBe("CONSENT_REQUIRED");
  });

  it("sends to an individual once consent is recorded", () => {
    expect(
      outreachEligibility(
        candidate({ recipientType: "individual" }),
        "mandate-enquiry",
        context({ consentRecorded: true }),
      ).decision,
    ).toBe("SEND_ALLOWED");
  });

  it("never auto-clears an investment promotion", () => {
    // Acceptance test 9.
    expect(outreachEligibility(candidate(), "investment-promotion", context()).decision)
      .toBe("PROMOTION_APPROVAL_REQUIRED");
    expect(
      outreachEligibility(candidate(), "investment-promotion", context({ promotionApproved: true }))
        .maySend,
    ).toBe(false);
  });

  it("holds a credit promotion for review", () => {
    expect(outreachEligibility(candidate(), "credit-promotion", context()).decision)
      .toBe("COMPLIANCE_APPROVAL_REQUIRED");
  });

  it("will not name the property without the deal owner's consent", () => {
    const decision = outreachEligibility(candidate(), "borrower-introduction", context());
    expect(decision.decision).toBe("COMPLIANCE_APPROVAL_REQUIRED");
    expect(decision.reason).toContain("consent to disclose");
  });

  it("suppresses a repeat approach on the same deal", () => {
    expect(
      outreachEligibility(candidate(), "mandate-enquiry", context({ alreadyContactedForDeal: true }))
        .decision,
    ).toBe("DRAFT_ONLY");
  });
});

describe("what a stage-one enquiry may contain", () => {
  const good =
    "We are Lode, a property acquisition platform. Do you look at bridging facilities of £400k-£600k on residential assets in the West Midlands, on a nine month term? Reply to opt out and we will not write again.";

  it("passes a neutral, identified enquiry with an opt-out", () => {
    // Acceptance test 5: no address, no personal information, no return.
    expect(checkNeutralEnquiry(good).clean).toBe(true);
  });

  it("catches a postcode", () => {
    expect(checkNeutralEnquiry(`${good} The property is at B23 6TT.`).clean).toBe(false);
  });

  it("catches a street address", () => {
    expect(checkNeutralEnquiry(`${good} It is 14 Chester Road.`).clean).toBe(false);
  });

  it("catches the seller's circumstances", () => {
    // Never leaves the platform, to anybody, at any stage.
    const finding = checkNeutralEnquiry(`${good} It is a probate sale.`);
    expect(finding.clean).toBe(false);
    expect(finding.findings.join(" ")).toContain("private information");
  });

  it("catches a projected return", () => {
    expect(checkNeutralEnquiry(`${good} Projected 22% return.`).clean).toBe(false);
  });

  it("requires an opt-out", () => {
    const noOptOut = "We are Lode. Do you look at bridging facilities in the West Midlands?";
    expect(checkNeutralEnquiry(noOptOut).findings.join(" ")).toContain("opt-out");
  });
});

describe("reading replies", () => {
  it("actions a removal request however it is phrased", () => {
    // Acceptance test 6: actioned even where confidence is low. Matched by rule,
    // first, so no model can decide otherwise.
    for (const text of [
      "Remove me from your list",
      "Please unsubscribe me",
      "opt out",
      "Do not contact us again",
      "STOP EMAILING ME",
      // Phrased for a letter. Somebody replying to post does not write
      // "unsubscribe", and a pattern that only knows the email wording misses
      // the postal opt-out entirely.
      "Please stop writing to me",
      "No more letters please",
      "Take me off your list",
      "Do not write again",
    ]) {
      const result = classifyReply(text);
      expect(result.classification, text).toBe("REMOVE_ME");
      expect(result.suppress, text).toBe(true);
    }
  });

  it("suppresses and escalates anything raising a legal point", () => {
    const result = classifyReply("This is a GDPR breach and I am contacting the ICO");
    expect(result.classification).toBe("LEGAL_COMPLIANCE");
    expect(result.suppress).toBe(true);
  });

  it("does not treat an out-of-office as a response", () => {
    expect(classifyReply("I am out of office until Monday").classification).toBe("AUTO_REPLY");
  });

  it("records an out-of-mandate reply so it is not tried again", () => {
    expect(classifyReply("Not for us, we don't fund land").classification).toBe("OUT_OF_MANDATE");
  });

  it("reads interest without treating it as clearance", () => {
    const result = classifyReply("Yes we would look at that, sounds workable");
    expect(result.classification).toBe("INTERESTED");
    expect(result.reason).toContain("compliance clearance");
  });

  it("treats anything it cannot classify as needing a person", () => {
    // Never as a positive: an ambiguous reply read as consent is how restricted
    // material reaches somebody who never asked for it.
    const result = classifyReply("hmm");
    expect(result.suppress).toBe(false);
    expect(result.reason).toContain("needing a person");
  });
});

describe("merging what several sources say", () => {
  it("resolves one organisation to one record while keeping provenance", () => {
    // Acceptance test 10.
    const first = candidate();
    const second = candidate({
      mandateSummary: {
        value: "£250k-£5m bridging, England and Wales",
        provenance: { sourceKey: "own-website", observedAt: "2026-08-22", inferred: false },
      },
    });
    const merged = reconcile(first, second);
    expect(merged.id).toBe("cand-1");
    expect(merged.mandateSummary?.provenance.sourceKey).toBe("own-website");
    expect(merged.domain?.provenance.observedAt).toBe("2026-08-20");
  });

  it("marks conflicting identity as conflicting rather than picking a winner", () => {
    const merged = reconcile(
      candidate(),
      candidate({
        domain: {
          value: "example-bridging-uk.com",
          provenance: { sourceKey: "search", observedAt: "2026-08-24", inferred: false },
        },
      }),
    );
    expect(merged.status).toBe("CONFLICTING");
  });

  it("never un-suppresses somebody because a second source is silent", () => {
    const merged = reconcile(candidate({ optedOut: true }), candidate({ optedOut: false }));
    expect(merged.optedOut).toBe(true);
  });

  it("keeps warning flags from every source", () => {
    const merged = reconcile(
      candidate({ warningFlags: ["insolvent"] }),
      candidate({ warningFlags: ["FCA warning list"] }),
    );
    expect(merged.warningFlags).toHaveLength(2);
  });
});

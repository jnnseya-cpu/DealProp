import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bps, fromMajor, pct } from "@shared/money";
import { appraise } from "@shared/domain/economics";
import type { DealInputs, FinanceTerms, PropertyFacts, SellerProfile } from "@shared/domain/types";
import { checkNeutralEnquiry, type Candidate } from "@shared/domain/outreach";

/**
 * The outreach service, against a real store.
 *
 * The gates were tested as pure functions before this existed; what was not
 * tested is that the path which actually sends goes through them. A correct
 * gate nothing calls stops nothing.
 */

const SCRATCH = mkdtempSync(path.join(tmpdir(), "lode-outreach-"));
process.env.LODE_DATA_FILE = path.join(SCRATCH, "lode.json");
delete process.env.DATABASE_URL;
process.env.NEXT_PUBLIC_SITE_URL = "https://lode.example";

const { composeMandateEnquiry, draftEnquiry, handleReply, sendApproved } = await import(
  "@backend/outreach/service"
);
const { fileStore } = await import("@backend/store/fileStore");
const { listOutreachMessages, listSuppressions, saveDiscoveryCandidate, saveOutreachMessage } =
  await import("@backend/store/repository");

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

const finance: FinanceTerms = {
  ltvBps: pct(70),
  refurbAdvanceBps: pct(100),
  annualRateBps: pct(12),
  arrangementFeeBps: pct(2),
  exitFeeBps: pct(1),
  interestRolledUp: true,
  lenderCosts: fromMajor(1_500),
};

const property: PropertyFacts = {
  id: "t",
  jurisdiction: "GB-ENG",
  postcodeArea: "B23",
  locality: "Erdington",
  propertyType: "house",
  tenure: "freehold",
  bedrooms: 3,
  occupancy: "vacant",
  openMarketValue: fromMajor(280_000),
  valuationConfidence: bps(8_500),
  refurbishmentEstimate: fromMajor(25_000),
  postWorksValue: fromMajor(320_000),
  monthlyRent: fromMajor(1_400),
  knownIssues: [],
};

const seller: SellerProfile = {
  situation: "probate",
  priorities: ["speed"],
  targetDays: 30,
  screening: { hasIndependentLegalAdvice: true, hasReceivedIndependentValuation: true },
};

const inputs: DealInputs = {
  property,
  seller,
  purchasePrice: fromMajor(225_000),
  buyerOwnsOtherProperty: true,
  buyerIsCompany: true,
  buyerIsNonResident: false,
  holdMonths: 9,
  structure: "bridging-refurb-refinance",
  finance,
  exit: "sell",
};

const appraisal = appraise(inputs);
const NOW = new Date("2026-08-25T12:00:00.000Z");

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "cand-1",
    organisationName: "Example Bridging Ltd",
    recipientType: "limited-company",
    publishedEmail: {
      value: "enquiries@lender.co.uk",
      provenance: { sourceKey: "funder-own-website", observedAt: "2026-08-24", inferred: false },
    },
    status: "VERIFIED",
    verifiedAt: "2026-08-24T00:00:00.000Z",
    warningFlags: [],
    optedOut: false,
    doNotContact: false,
    ...overrides,
  };
}

async function reset(): Promise<void> {
  await fileStore.replaceAll({
    deals: [], buyBoxes: [], fundingBoxes: [], subscribers: [], accounts: [], auditEvents: [],
    blogViews: [], subscriptions: [], creditLots: [], ledgerEntries: [], billingEvents: [],
    discoveryCandidates: [], outreachMessages: [], suppressions: [],
    dataRoomGrants: [],
    pendingCharges: [],
  });
  rmSync(process.env.LODE_DATA_FILE ?? "", { force: true });
}

beforeEach(reset);

describe("what a composed enquiry says", () => {
  const composed = composeMandateEnquiry(appraisal, "Lode", "https://lode.example/outreach/opt-out");

  it("is anonymous by construction", () => {
    // The composer is the thing most likely to start leaking, so what it
    // produces is checked by the same rule that guards every send.
    expect(checkNeutralEnquiry(`${composed.subject} ${composed.body}`).clean).toBe(true);
  });

  it("names a facility band rather than the figure", () => {
    expect(composed.subject).toMatch(/£\d/);
    expect(composed.body).not.toContain(String(Math.round(appraisal.funding.seniorDebt / 100)));
  });

  it("never mentions the seller's situation", () => {
    expect(`${composed.subject} ${composed.body}`.toLowerCase()).not.toContain("probate");
  });

  it("identifies the sender and carries an opt-out", () => {
    expect(composed.body).toContain("We are Lode");
    expect(composed.body).toContain("opt out");
  });
});

describe("drafting", () => {
  it("stores a draft, and sends nothing", async () => {
    const result = await draftEnquiry({
      candidate: candidate(),
      dealId: "deal-1",
      appraisal,
      senderName: "Lode",
      optOutUrl: "https://lode.example/outreach/opt-out",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    const stored = await listOutreachMessages();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.status).toBe("draft");
    expect(stored[0]?.sentAt).toBeUndefined();
  });

  it("stores a message to a suppressed recipient as refused, not as a draft", async () => {
    // A draft somebody might approve later without reading why is worse than a
    // refusal.
    const result = await draftEnquiry({
      candidate: candidate({ optedOut: true }),
      dealId: "deal-1",
      appraisal,
      senderName: "Lode",
      optOutUrl: "https://lode.example/outreach/opt-out",
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect((await listOutreachMessages())[0]?.status).toBe("refused");
  });

  it("refuses a candidate with no published address", async () => {
    const result = await draftEnquiry({
      candidate: candidate({ publishedEmail: undefined }),
      dealId: "deal-1",
      appraisal,
      senderName: "Lode",
      optOutUrl: "x",
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(await listOutreachMessages()).toHaveLength(0);
  });

  it("marks a repeat approach on the same deal as draft-only", async () => {
    const input = {
      candidate: candidate(),
      dealId: "deal-1",
      appraisal,
      senderName: "Lode",
      optOutUrl: "x",
      now: NOW,
    };
    await draftEnquiry(input);
    const second = await draftEnquiry(input);
    expect(second.message?.decision).toBe("DRAFT_ONLY");
  });
});

describe("sending", () => {
  async function drafted(): Promise<string> {
    await saveDiscoveryCandidate({
      candidate: candidate(),
      notes: [],
      discoveredAt: NOW.toISOString(),
      approvedAt: NOW.toISOString(),
      approvedBy: "ops@example.com",
    });
    const result = await draftEnquiry({
      candidate: candidate(),
      dealId: "deal-1",
      appraisal,
      senderName: "Lode",
      optOutUrl: "x",
      now: NOW,
    });
    return result.message?.id ?? "";
  }

  it("refuses to send a message nobody approved", async () => {
    const id = await drafted();
    const result = await sendApproved(id, { email: "ops@example.com" }, NOW);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("approved");
  });

  it("sends an approved message", async () => {
    const id = await drafted();
    const message = (await listOutreachMessages()).find((m) => m.id === id);
    await saveOutreachMessage({ ...message!, status: "approved", approvedBy: "ops@example.com" });

    const result = await sendApproved(id, { email: "ops@example.com" }, NOW);
    expect(result.ok).toBe(true);
    expect((await listOutreachMessages()).find((m) => m.id === id)?.status).toBe("sent");
  });

  it("refuses at the moment of sending if the address was suppressed after approval", async () => {
    // The gap between approving and sending is exactly where somebody opts out.
    const id = await drafted();
    const message = (await listOutreachMessages()).find((m) => m.id === id);
    await saveOutreachMessage({ ...message!, status: "approved", approvedBy: "ops@example.com" });

    await handleReply("enquiries@lender.co.uk", "please remove me", NOW);

    const result = await sendApproved(id, { email: "ops@example.com" }, NOW);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("suppressed");
    expect((await listOutreachMessages()).find((m) => m.id === id)?.status).toBe("refused");
  });

  it("does not send the same message twice", async () => {
    const id = await drafted();
    const message = (await listOutreachMessages()).find((m) => m.id === id);
    await saveOutreachMessage({ ...message!, status: "approved", approvedBy: "ops@example.com" });

    await sendApproved(id, { email: "ops@example.com" }, NOW);
    const again = await sendApproved(id, { email: "ops@example.com" }, NOW);
    expect(again.ok).toBe(false);
    expect(again.reason).toContain("Already sent");
  });
});

describe("replies", () => {
  it("suppresses on a removal request and marks the candidate", async () => {
    await saveDiscoveryCandidate({
      candidate: candidate(),
      notes: [],
      discoveredAt: NOW.toISOString(),
    });

    const result = await handleReply("Enquiries@Lender.co.uk", "Remove me from your list", NOW);
    expect(result.suppressed).toBe(true);
    expect((await listSuppressions())[0]?.email).toBe("enquiries@lender.co.uk");
  });

  it("suppresses on a legal or regulatory reply too", async () => {
    const result = await handleReply("x@lender.co.uk", "This breaches GDPR", NOW);
    expect(result.classification).toBe("LEGAL_COMPLIANCE");
    expect(result.suppressed).toBe(true);
  });

  it("does not suppress on ordinary interest", async () => {
    const result = await handleReply("x@lender.co.uk", "Yes we are interested, send more", NOW);
    expect(result.suppressed).toBe(false);
    expect(await listSuppressions()).toHaveLength(0);
  });

  it("records the classification against the message it answers", async () => {
    await draftEnquiry({
      candidate: candidate(),
      dealId: "deal-1",
      appraisal,
      senderName: "Lode",
      optOutUrl: "x",
      now: NOW,
    });
    await handleReply("enquiries@lender.co.uk", "not for us, outside our mandate", NOW);
    expect((await listOutreachMessages())[0]?.replyClassification).toBe("OUT_OF_MANDATE");
  });
});

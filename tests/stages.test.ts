import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bps, fromMajor, pct } from "@shared/money";
import type { DealInputs, FinanceTerms, PropertyFacts, SellerProfile } from "@shared/domain/types";
import type { Candidate } from "@shared/domain/outreach";

/**
 * Stages two and three.
 *
 * Each adds something the previous stage deliberately withheld, so the tests
 * that matter are the ones proving a stage cannot be skipped.
 */

const SCRATCH = mkdtempSync(path.join(tmpdir(), "lode-stages-"));
process.env.LODE_DATA_FILE = path.join(SCRATCH, "lode.json");
delete process.env.DATABASE_URL;

const { composeTeaser, grantDataRoom, openDataRoom, sendTeaser, GRANT_DAYS } = await import(
  "@backend/outreach/stages"
);
const { fileStore } = await import("@backend/store/fileStore");
const { saveDeal, saveDiscoveryCandidate, saveOutreachMessage, listDataRoomGrants } = await import(
  "@backend/store/repository"
);
const { checkNeutralEnquiry } = await import("@shared/domain/outreach");

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const NOW = new Date("2026-08-26T11:00:00Z");

const finance: FinanceTerms = {
  ltvBps: pct(70), refurbAdvanceBps: pct(100), annualRateBps: pct(12),
  arrangementFeeBps: pct(2), exitFeeBps: pct(1), interestRolledUp: true,
  lenderCosts: fromMajor(1_500),
};
const property: PropertyFacts = {
  id: "t", jurisdiction: "GB-ENG", postcodeArea: "B23", locality: "Erdington",
  propertyType: "house", tenure: "freehold", bedrooms: 3, occupancy: "vacant",
  openMarketValue: fromMajor(280_000), valuationConfidence: bps(8_500),
  refurbishmentEstimate: fromMajor(25_000), postWorksValue: fromMajor(320_000),
  monthlyRent: fromMajor(1_400), knownIssues: [],
};
const seller: SellerProfile = {
  situation: "probate", priorities: ["speed"], targetDays: 30,
  screening: { hasIndependentLegalAdvice: true, hasReceivedIndependentValuation: true },
};
const inputs: DealInputs = {
  property, seller, purchasePrice: fromMajor(225_000), buyerOwnsOtherProperty: true,
  buyerIsCompany: true, buyerIsNonResident: false, holdMonths: 9,
  structure: "bridging-refurb-refinance", finance, exit: "sell",
};

const candidate: Candidate = {
  id: "cand-1",
  organisationName: "Example Bridging Ltd",
  recipientType: "limited-company",
  publishedEmail: {
    value: "enquiries@lender.co.uk",
    provenance: { sourceKey: "funder-own-website", observedAt: "2026-08-25", inferred: false },
  },
  status: "VERIFIED",
  verifiedAt: "2026-08-25T00:00:00.000Z",
  warningFlags: [],
  optedOut: false,
  doNotContact: false,
};

const deal = {
  id: "deal-1", reference: "LODE-0001", createdAt: NOW.toISOString(),
  property, seller, inputs, borrowerCompletedDeals: 2, status: "new" as const,
};

async function reset(): Promise<void> {
  await fileStore.replaceAll({
    deals: [], buyBoxes: [], fundingBoxes: [], subscribers: [], accounts: [], auditEvents: [],
    blogViews: [], subscriptions: [], creditLots: [], ledgerEntries: [], billingEvents: [],
    discoveryCandidates: [], outreachMessages: [], suppressions: [], dataRoomGrants: [], agentDecisions: [], dealFees: [],
    pendingCharges: [],
  });
  rmSync(process.env.LODE_DATA_FILE ?? "", { force: true });
  await saveDeal(deal);
  await saveDiscoveryCandidate({
    candidate, notes: [], discoveredAt: NOW.toISOString(),
    approvedAt: NOW.toISOString(), approvedBy: "ops@example.com",
  });
}

async function positiveReply(): Promise<void> {
  await saveOutreachMessage({
    id: "msg-1", candidateId: "cand-1", dealId: "deal-1", messageType: "mandate-enquiry", channel: "email",
    to: "enquiries@lender.co.uk", subject: "s", body: "b", decision: "SEND_ALLOWED",
    decisionReason: "r", status: "sent", createdAt: NOW.toISOString(),
    sentAt: NOW.toISOString(), replyReceivedAt: NOW.toISOString(), replyClassification: "INTERESTED",
  });
}

async function consent(scope: "identified-teaser" | "full-pack"): Promise<void> {
  await saveDeal({
    ...deal,
    disclosureConsent: { at: NOW.toISOString(), by: "owner@example.com", scope, note: "By email." },
  });
}

beforeEach(reset);

describe("what the teaser says", () => {
  const composed = composeTeaser(deal, "Lode");

  it("names the property, which is the point of stage two", () => {
    expect(composed.body).toContain("Erdington");
    expect(composed.body).toContain("B23");
  });

  it("never mentions the seller's situation, at any stage", () => {
    // It was given to us to get them help, not to make a deal compelling.
    expect(`${composed.subject} ${composed.body}`.toLowerCase()).not.toContain("probate");
  });

  it("carries the risk warning and an opt-out", () => {
    expect(composed.body).toContain("capital could be lost");
    expect(composed.body).toContain("remove me");
  });

  it("would fail the stage-one anonymity check, which is how they differ", () => {
    expect(checkNeutralEnquiry(`${composed.subject} ${composed.body}`).clean).toBe(false);
  });
});

describe("stage two cannot be skipped into", () => {
  it("refuses without the deal owner's consent", async () => {
    await positiveReply();
    const result = await sendTeaser({
      candidateId: "cand-1", dealId: "deal-1", senderName: "Lode",
      approvedBy: "ops@example.com", now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("consented");
  });

  it("refuses without a positive reply on record", async () => {
    await consent("identified-teaser");
    const result = await sendTeaser({
      candidateId: "cand-1", dealId: "deal-1", senderName: "Lode",
      approvedBy: "ops@example.com", now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("in a hurry");
  });

  it("drafts once both are true, and still needs its own approval", async () => {
    await consent("identified-teaser");
    await positiveReply();
    const result = await sendTeaser({
      candidateId: "cand-1", dealId: "deal-1", senderName: "Lode",
      approvedBy: "ops@example.com", now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.message?.status).toBe("draft");
    expect(result.reason).toContain("does not carry");
  });
});

describe("stage three cannot be skipped into", () => {
  async function teaserSent(): Promise<void> {
    await saveOutreachMessage({
      id: "msg-2", candidateId: "cand-1", dealId: "deal-1",
      messageType: "borrower-introduction", channel: "email", to: "enquiries@lender.co.uk",
      subject: "s", body: "b", decision: "SEND_ALLOWED", decisionReason: "r",
      status: "sent", createdAt: NOW.toISOString(), sentAt: NOW.toISOString(),
    });
  }

  it("refuses where the owner consented only to a named teaser", async () => {
    await consent("identified-teaser");
    await teaserSent();
    const result = await grantDataRoom({
      candidateId: "cand-1", dealId: "deal-1", grantedBy: "ops@example.com", now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("own consent");
  });

  it("refuses where no teaser has gone", async () => {
    await consent("full-pack");
    const result = await grantDataRoom({
      candidateId: "cand-1", dealId: "deal-1", grantedBy: "ops@example.com", now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not optional");
  });

  it("grants an expiring token once both are true", async () => {
    await consent("full-pack");
    await teaserSent();
    const result = await grantDataRoom({
      candidateId: "cand-1", dealId: "deal-1", grantedBy: "ops@example.com", now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.grant?.token.length).toBeGreaterThan(30);
    const days = (new Date(result.grant?.expiresAt ?? "").getTime() - NOW.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(GRANT_DAYS);
  });

  it("does not issue a second live grant to the same funder", async () => {
    await consent("full-pack");
    await teaserSent();
    await grantDataRoom({ candidateId: "cand-1", dealId: "deal-1", grantedBy: "a", now: NOW });
    await grantDataRoom({ candidateId: "cand-1", dealId: "deal-1", grantedBy: "a", now: NOW });
    expect(await listDataRoomGrants()).toHaveLength(1);
  });
});

describe("opening a grant", () => {
  async function granted(): Promise<string> {
    await consent("full-pack");
    await saveOutreachMessage({
      id: "msg-2", candidateId: "cand-1", dealId: "deal-1",
      messageType: "borrower-introduction", channel: "email", to: "enquiries@lender.co.uk",
      subject: "s", body: "b", decision: "SEND_ALLOWED", decisionReason: "r",
      status: "sent", createdAt: NOW.toISOString(), sentAt: NOW.toISOString(),
    });
    const result = await grantDataRoom({
      candidateId: "cand-1", dealId: "deal-1", grantedBy: "ops@example.com", now: NOW,
    });
    return result.grant?.token ?? "";
  }

  it("refuses a token that does not exist", async () => {
    expect((await openDataRoom("not-a-token", NOW)).valid).toBe(false);
  });

  it("opens a live grant and counts the opening", async () => {
    const token = await granted();
    expect((await openDataRoom(token, NOW)).valid).toBe(true);
    await openDataRoom(token, NOW);
    expect((await listDataRoomGrants())[0]?.accessCount).toBe(2);
  });

  it("stops working on expiry, with nothing needing to run", async () => {
    const token = await granted();
    const later = new Date(NOW.getTime() + (GRANT_DAYS + 1) * 86_400_000);
    const check = await openDataRoom(token, later);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("expired");
  });

  it("stops working once withdrawn", async () => {
    const token = await granted();
    const grant = (await listDataRoomGrants())[0];
    await (await import("@backend/store/repository")).saveDataRoomGrant({
      ...grant!, revokedAt: NOW.toISOString(), revokedBy: "ops@example.com",
    });
    expect((await openDataRoom(token, NOW)).valid).toBe(false);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bps, fromMajor, pct } from "@shared/money";
import type { DealInputs, FinanceTerms, PropertyFacts, SellerProfile } from "@shared/domain/types";

/**
 * The guarded §10 transition against the store. The pure gate is covered in
 * dealTransition.test.ts; here it is the wiring: the status only changes through
 * this path, an illegal move is refused, withdraw is always open, and every
 * transition is on the append-only audit trail.
 */

const SCRATCH = mkdtempSync(path.join(tmpdir(), "lode-transition-"));
process.env.LODE_DATA_FILE = path.join(SCRATCH, "lode.json");
delete process.env.DATABASE_URL;

const { transitionDeal } = await import("@backend/workflow");
const { fileStore } = await import("@backend/store/fileStore");
const { getDeal, listAudit, saveDeal } = await import("@backend/store/repository");

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const property: PropertyFacts = {
  id: "t", jurisdiction: "GB-ENG", postcodeArea: "B23", locality: "Erdington", propertyType: "house",
  tenure: "freehold", bedrooms: 3, occupancy: "vacant", openMarketValue: fromMajor(280_000),
  valuationConfidence: bps(8_500), refurbishmentEstimate: fromMajor(25_000), postWorksValue: fromMajor(320_000),
  monthlyRent: fromMajor(1_400), knownIssues: [],
};
const seller: SellerProfile = { situation: "probate", priorities: ["speed"], targetDays: 30, screening: {} };
const finance: FinanceTerms = {
  ltvBps: pct(70), refurbAdvanceBps: pct(100), annualRateBps: pct(12), arrangementFeeBps: pct(2),
  exitFeeBps: pct(1), interestRolledUp: true, lenderCosts: fromMajor(1_500),
};
const inputs: DealInputs = {
  property, seller, purchasePrice: fromMajor(225_000), buyerOwnsOtherProperty: true, buyerIsCompany: true,
  buyerIsNonResident: false, holdMonths: 9, structure: "bridging-refurb-refinance", finance, exit: "sell",
};

const jo = { id: "acc-1", email: "jo@example.com", name: "Jo Bloggs" };

const deal = (status: "new" | "funded") => ({
  id: "deal-1", reference: "LODE-0001", createdAt: "2026-08-31T10:00:00Z", property, seller, inputs,
  borrowerCompletedDeals: 0, status,
});

async function reset(): Promise<void> {
  await fileStore.replaceAll({
    deals: [], buyBoxes: [], fundingBoxes: [], subscribers: [], accounts: [], auditEvents: [], blogViews: [],
    subscriptions: [], creditLots: [], ledgerEntries: [], billingEvents: [], discoveryCandidates: [],
    outreachMessages: [], suppressions: [], dataRoomGrants: [], agentDecisions: [], dealFees: [], reveals: [],
    payoutRecipients: [], payouts: [], pendingCharges: [],
  });
  rmSync(process.env.LODE_DATA_FILE ?? "", { force: true });
}

beforeEach(reset);

describe("transitioning a deal", () => {
  it("returns nothing for a deal that does not exist", async () => {
    expect((await transitionDeal("nope", "qualified", jo)).ok).toBe(false);
  });

  it("refuses a move that skips the ordering, leaving the status untouched", async () => {
    await saveDeal(deal("new"));
    const result = await transitionDeal("deal-1", "completed", jo);
    expect(result.ok).toBe(false);
    expect((await getDeal("deal-1"))?.status).toBe("new");
  });

  it("withdraws from any live status and records it on the audit trail", async () => {
    await saveDeal(deal("new"));
    const result = await transitionDeal("deal-1", "withdrawn", jo);
    expect(result.ok).toBe(true);
    expect((await getDeal("deal-1"))?.status).toBe("withdrawn");
    const audit = await listAudit({ subject: "deal-1" });
    expect(audit.some((e) => e.action === "deal-transitioned")).toBe(true);
  });

  it("refuses completion without a conveyancer and a date (A16), banking no completedAt", async () => {
    await saveDeal(deal("funded"));
    const noDate = await transitionDeal("deal-1", "completed", jo);
    expect(noDate.ok).toBe(false); // no solicitor instructed on this fixture, and no date
    const after = await getDeal("deal-1");
    expect(after?.status).toBe("funded");
    expect(after?.completedAt).toBeUndefined();
  });
});

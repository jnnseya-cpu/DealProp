import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bps, fromMajor, pct } from "@shared/money";
import type { DealInputs, FinanceTerms, PropertyFacts, SellerProfile } from "@shared/domain/types";
import { STANDARD_MILESTONES } from "@shared/domain/completion";
import type { Actor } from "@shared/domain/agents";

/**
 * Running the agents against the store, and deciding what they say.
 *
 * The tests worth having are the ones about trust: that a request cannot name
 * its own effect, that a shared credential cannot sign anything off, and that
 * the one effect which writes writes exactly one thing.
 */

const SCRATCH = mkdtempSync(path.join(tmpdir(), "lode-agent-service-"));
process.env.LODE_DATA_FILE = path.join(SCRATCH, "lode.json");
delete process.env.DATABASE_URL;

const { decideProposal, runAgentsForDeal } = await import("@backend/agents/service");
const { fileStore } = await import("@backend/store/fileStore");
const { getDeal, listAgentDecisions, saveDeal } = await import("@backend/store/repository");

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const NOW = new Date("2026-08-31T10:00:00Z");

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

const deal = {
  id: "deal-1",
  reference: "LODE-0001",
  createdAt: NOW.toISOString(),
  property,
  seller,
  inputs,
  borrowerCompletedDeals: 2,
  status: "new" as const,
  offers: [
    {
      id: "off-1",
      lender: "Example Bridging",
      annualRateBps: pct(11),
      arrangementFeeBps: pct(2),
      brokerFeeBps: pct(1),
      exitFeeBps: pct(1),
      ltvBps: pct(70),
      lenderCosts: fromMajor(1_500),
      interestRolledUp: true,
      termMonths: 12,
      confidence: "credit-backed" as const,
      receivedAt: NOW.toISOString(),
    },
  ],
};

const jo: Actor = { kind: "account", id: "acc-1", name: "Jo Bloggs", email: "jo@example.com" };

async function reset(): Promise<void> {
  await fileStore.replaceAll({
    deals: [],
    buyBoxes: [],
    fundingBoxes: [],
    subscribers: [],
    accounts: [],
    auditEvents: [],
    blogViews: [],
    subscriptions: [],
    creditLots: [],
    ledgerEntries: [],
    billingEvents: [],
    discoveryCandidates: [],
    outreachMessages: [],
    suppressions: [],
    dataRoomGrants: [],
    agentDecisions: [], dealFees: [],
    reveals: [],
    pendingCharges: [],
  });
  rmSync(process.env.LODE_DATA_FILE ?? "", { force: true });
  await saveDeal(deal);
}

beforeEach(reset);

async function termsProposalKey(): Promise<string> {
  const run = await runAgentsForDeal("deal-1");
  const proposal = run?.run.proposals.find((p) => p.key.startsWith("terms:cheapest"));
  if (proposal === undefined) throw new Error("no terms proposal");
  return proposal.key;
}

describe("running the agents against a stored deal", () => {
  it("returns nothing for a deal that does not exist", async () => {
    expect(await runAgentsForDeal("nope")).toBeUndefined();
  });

  it("fires every agent or says why it did not", async () => {
    const run = await runAgentsForDeal("deal-1");
    expect(run?.run.outcomes).toHaveLength(9);
    for (const outcome of run?.run.outcomes ?? []) {
      if (outcome.proposals.length === 0) expect(outcome.dormantReason ?? "").not.toBe("");
    }
  });
});

describe("deciding a proposal", () => {
  it("refuses the shared operator password", async () => {
    const key = await termsProposalKey();
    const result = await decideProposal({
      dealId: "deal-1",
      proposalKey: key,
      decision: "accepted",
      note: "Cheapest overall.",
      actor: { kind: "shared-operator" },
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/named person/);
    expect(await listAgentDecisions("deal-1")).toHaveLength(0);
  });

  it("refuses a decision with no reason", async () => {
    const result = await decideProposal({
      dealId: "deal-1",
      proposalKey: await termsProposalKey(),
      decision: "accepted",
      note: "",
      actor: jo,
    });
    expect(result.ok).toBe(false);
    expect(await listAgentDecisions("deal-1")).toHaveLength(0);
  });

  it("refuses a proposal the agents are not currently making", async () => {
    const result = await decideProposal({
      dealId: "deal-1",
      proposalKey: "due-diligence:adopt-plan",
      decision: "accepted",
      note: "Adopting the plan.",
      actor: jo,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no longer being made/);
    expect((await getDeal("deal-1"))?.milestones).toBeUndefined();
  });

  it("records the decision against the person who made it", async () => {
    const key = await termsProposalKey();
    const result = await decideProposal({
      dealId: "deal-1",
      proposalKey: key,
      decision: "accepted",
      note: "  Cheapest in total, advance covers the gap.  ",
      actor: jo,
    });
    expect(result.ok).toBe(true);

    const [recorded] = await listAgentDecisions("deal-1");
    expect(recorded?.byName).toBe("Jo Bloggs");
    expect(recorded?.byAccountId).toBe("acc-1");
    expect(recorded?.note).toBe("Cheapest in total, advance covers the gap.");
    // Taken from the server-side proposal, never from the request.
    expect(recorded?.effect).toBe("record-selection");
    expect(recorded?.agentId).toBe("terms");
    expect(recorded?.proposalHeadline).toContain("Example Bridging");
  });
});

describe("the one effect that writes", () => {
  async function selectTerms(): Promise<void> {
    await decideProposal({
      dealId: "deal-1",
      proposalKey: await termsProposalKey(),
      decision: "accepted",
      note: "Selected.",
      actor: jo,
    });
  }

  it("wakes the Due-Diligence Agent only once a person selects terms", async () => {
    const before = await runAgentsForDeal("deal-1");
    expect(before?.run.proposals.some((p) => p.agentId === "due-diligence")).toBe(false);

    await selectTerms();

    const after = await runAgentsForDeal("deal-1");
    expect(after?.run.proposals.some((p) => p.key === "due-diligence:adopt-plan")).toBe(true);
  });

  it("adopts the standard plan with every condition not started", async () => {
    await selectTerms();
    const result = await decideProposal({
      dealId: "deal-1",
      proposalKey: "due-diligence:adopt-plan",
      decision: "accepted",
      note: "Standard English purchase.",
      actor: jo,
    });
    expect(result.ok).toBe(true);

    const record = await getDeal("deal-1");
    expect(record?.milestones).toHaveLength(STANDARD_MILESTONES.length);
    for (const milestone of record?.milestones ?? []) {
      expect(milestone.status).toBe("not-started");
    }
  });

  it("does not reset a plan somebody has been working through", async () => {
    await selectTerms();
    await saveDeal({
      ...deal,
      milestones: STANDARD_MILESTONES.map((m) => ({ ...m, status: "complete" as const })),
    });

    // The proposal is no longer made once a plan exists, so this is the belt to
    // the braces: even asked directly, it must not overwrite the plan.
    await decideProposal({
      dealId: "deal-1",
      proposalKey: "due-diligence:adopt-plan",
      decision: "accepted",
      note: "Trying again.",
      actor: jo,
    });

    const record = await getDeal("deal-1");
    expect(record?.milestones?.every((m) => m.status === "complete")).toBe(true);
  });

  it("dismissing writes nothing to the deal", async () => {
    await selectTerms();
    const result = await decideProposal({
      dealId: "deal-1",
      proposalKey: "due-diligence:adopt-plan",
      decision: "dismissed",
      note: "This one needs its own conditions.",
      actor: jo,
    });
    expect(result.ok).toBe(true);
    expect((await getDeal("deal-1"))?.milestones).toBeUndefined();
  });
});

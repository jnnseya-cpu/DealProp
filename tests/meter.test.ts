import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fromMajor, money } from "@shared/money";
import { expiryFrom } from "@shared/domain/ledger";

/**
 * The memorandum meter, against a real store.
 *
 * This is the leak that mattered most: the memorandum is the artefact that
 * leaves the building permanently, and a plan that lists twenty and counts none
 * sells the whole library for one month of the cheapest plan that includes them.
 * A unit test of the arithmetic would not have caught it — the arithmetic was
 * always right, and nothing called it.
 */

const SCRATCH = mkdtempSync(path.join(tmpdir(), "lode-meter-"));
process.env.LODE_DATA_FILE = path.join(SCRATCH, "lode.json");
delete process.env.DATABASE_URL;

const { meter } = await import("@backend/billing/meter");
const { applyTopUp, saveAccount, saveSubscription, listLedgerEntries } = await import(
  "@backend/store/repository"
);
const { fileStore } = await import("@backend/store/fileStore");

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

const NOW = new Date("2026-08-25T12:00:00.000Z");
const PERIOD_START = "2026-08-01T00:00:00.000Z";
const PERIOD_END = "2026-09-01T00:00:00.000Z";

const investor = {
  id: "acc-investor",
  email: "investor@example.com",
  name: "Ada Investor",
  role: "investor" as const,
  passwordHash: "x",
  passwordSalt: "y",
  createdAt: PERIOD_START,
};

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
    dataRoomGrants: [], agentDecisions: [], dealFees: [],
    reveals: [],
    payoutRecipients: [],
    payouts: [],
    pendingCharges: [],
  });
  rmSync(process.env.LODE_DATA_FILE ?? "", { force: true });
  await saveAccount(investor);
}

async function onPlan(planId: string): Promise<void> {
  await saveSubscription({
    id: "sub-1",
    accountId: investor.id,
    planId: planId as never,
    status: "active",
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
  });
}

/** A counter rather than a random id, so a failure reproduces exactly. */
let seq = 0;

async function topUp(amount: number): Promise<void> {
  seq += 1;
  await applyTopUp({
    accountId: investor.id,
    idempotencyKey: `pay-${amount}-${seq}`,
    at: PERIOD_START,
    purchased: {
      lotId: `lot-${seq}`,
      amount: fromMajor(amount),
      cashGross: fromMajor(amount),
      cashTax: fromMajor(0),
      expiresAt: expiryFrom(PERIOD_START, 12),
    },
    paymentReference: `payref-${seq}`,
    entryIdPrefix: `e-${seq}`,
    reason: "Top-up",
  });
}

beforeEach(reset);

describe("what a plan includes runs out", () => {
  it("gives an account with no subscription nothing", () => {
    // The free plan includes no memoranda, so there is nothing to meter and
    // nothing to buy one-off.
    return meter(investor, "memorandum-export", "deal-1", NOW).then((decision) => {
      expect(decision.allowed).toBe(false);
      expect(decision.outcome).toBe("refused");
    });
  });

  it("decides the limit against the instant it is given, not the wall clock", async () => {
    // The entitlement used to be read from `new Date()` while everything else
    // in the same decision used `now`. It surfaced when the container clock
    // crossed PERIOD_END and every allowance test began refusing — but the
    // failure it describes is a customer being refused what they paid for
    // because the period rolled over between two lines of one decision.
    await onPlan("funder-private");
    const insidePeriod = await meter(investor, "memorandum-export", "deal-a", NOW);
    expect(insidePeriod.allowed).toBe(true);
    expect(insidePeriod.entitlements.memorandaPerPeriod).toBe(10);

    const afterPeriod = await meter(
      investor,
      "memorandum-export",
      "deal-b",
      new Date("2026-09-15T12:00:00.000Z"),
    );
    expect(afterPeriod.allowed).toBe(false);
  });

  it("counts each memorandum against the plan until they are gone", async () => {
    // funder-private includes ten.
    await onPlan("funder-private");

    for (let i = 0; i < 10; i += 1) {
      const decision = await meter(investor, "memorandum-export", `deal-${i}`, NOW);
      expect(decision.allowed, `deal-${i}`).toBe(true);
      expect(decision.outcome, `deal-${i}`).toBe("allowance");
    }

    const eleventh = await meter(investor, "memorandum-export", "deal-11", NOW);
    expect(eleventh.allowed).toBe(false);
    expect(eleventh.reason).toContain("10");
  });

  it("is free to reopen one already taken this period", async () => {
    // A cap that charges twice for the same document is a support ticket.
    await onPlan("funder-private");
    await meter(investor, "memorandum-export", "deal-1", NOW);

    const again = await meter(investor, "memorandum-export", "deal-1", NOW);
    expect(again.allowed).toBe(true);
    expect(again.outcome).toBe("already-paid");

    const used = (await listLedgerEntries(investor.id)).filter((e) => e.kind === "allowance");
    expect(used).toHaveLength(1);
  });

  it("charges the prepaid balance past the allowance rather than refusing", async () => {
    // Refusing outright caps revenue at the plan price and pushes the heaviest
    // users away. memorandum-export is £1.50.
    await onPlan("funder-private");
    await topUp(10);
    for (let i = 0; i < 10; i += 1) await meter(investor, "memorandum-export", `d${i}`, NOW);

    const overage = await meter(investor, "memorandum-export", "d-extra", NOW);
    expect(overage.allowed).toBe(true);
    expect(overage.outcome).toBe("charged");

    const spends = (await listLedgerEntries(investor.id)).filter((e) => e.kind === "spend");
    expect(spends).toHaveLength(1);
    expect(spends[0]?.amount).toBe(-fromMajor(1.5));
  });

  it("refuses once the allowance and the balance are both gone", async () => {
    await onPlan("funder-private");
    await topUp(1);
    for (let i = 0; i < 10; i += 1) await meter(investor, "memorandum-export", `d${i}`, NOW);

    const overage = await meter(investor, "memorandum-export", "d-extra", NOW);
    expect(overage.allowed).toBe(false);
    expect(overage.reason).toContain("1.50");
  });

  it("does not charge twice when an overage request is retried", async () => {
    await onPlan("funder-private");
    await topUp(10);
    for (let i = 0; i < 10; i += 1) await meter(investor, "memorandum-export", `d${i}`, NOW);

    await meter(investor, "memorandum-export", "d-extra", NOW);
    await meter(investor, "memorandum-export", "d-extra", NOW);

    const spends = (await listLedgerEntries(investor.id)).filter((e) => e.kind === "spend");
    expect(spends).toHaveLength(1);
  });

  it("refuses everything to an account that owes us money", async () => {
    // Somebody who took the money back after using the service does not carry
    // on using it while that stands.
    await onPlan("funder-private");
    await topUp(50);
    await fileStore.recordNote({
      accountId: investor.id,
      idempotencyKey: "debt-1",
      at: PERIOD_START,
      kind: "debt",
      amount: money(-fromMajor(70)),
      entryId: "d1",
      reason: "Reversed after being spent.",
    });

    const decision = await meter(investor, "memorandum-export", "deal-1", NOW);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("suspended");
  });

  it("does not meter staff", async () => {
    const decision = await meter(
      { id: "acc-op", role: "operator" },
      "memorandum-export",
      "deal-1",
      NOW,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.outcome).toBe("not-metered");
  });

  it("does not meter the shared operator password", async () => {
    const decision = await meter(undefined, "memorandum-export", "deal-1", NOW);
    expect(decision.outcome).toBe("not-metered");
  });

  it("gives a past-due account nothing new, however much balance it holds", async () => {
    // The grace window keeps what exists working. It does not hand over more.
    await saveSubscription({
      id: "sub-1",
      accountId: investor.id,
      planId: "funder-private",
      status: "past-due",
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      delinquentSince: "2026-08-24T00:00:00.000Z",
    });
    await topUp(100);

    const decision = await meter(investor, "memorandum-export", "deal-1", NOW);
    expect(decision.allowed).toBe(false);
  });
});

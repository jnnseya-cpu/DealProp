import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fromMajor, pct } from "@shared/money";
import { availableBalance, standing } from "@shared/domain/ledger";
import type { BuyBox } from "@shared/domain/matching";
import type { Subscriber } from "@shared/domain/newsletter";
import type { DealRecord, Store } from "@backend/store/schema";
import { fileStore } from "@backend/store/fileStore";

/**
 * Contract tests for the store.
 *
 * The same suite runs against both engines. That is the point: the repository
 * exists so persistence can be swapped without any engine code changing, and
 * the only way that claim stays true is if both implementations are held to one
 * set of behaviours.
 *
 * Postgres is skipped when TEST_DATABASE_URL is unset, so the suite still runs
 * on a machine with no database. A skip is reported rather than passed
 * silently — a green run that quietly tested one engine would be worse than no
 * test at all.
 */

const TEST_URL = process.env.TEST_DATABASE_URL;

function subscriber(overrides: Partial<Subscriber> = {}): Subscriber {
  return {
    id: "sub-1",
    email: "someone@example.com",
    audiences: ["investor"],
    status: "pending",
    confirmToken: "confirm-1",
    unsubscribeToken: "unsub-1",
    consentedAt: "2026-08-01T00:00:00.000Z",
    consentText: "test consent",
    ...overrides,
  } as Subscriber;
}

function buyBox(overrides: Partial<BuyBox> = {}): BuyBox {
  return {
    id: "buy-1",
    investorName: "Contract Capital",
    jurisdictions: ["GB-ENG"],
    localities: ["Erdington"],
    propertyTypes: ["house"],
    minPrice: fromMajor(120_000),
    maxPrice: fromMajor(300_000),
    minBedrooms: 2,
    minMarginBps: pct(15),
    maxRefurbishment: fromMajor(60_000),
    acceptsRefurbishment: true,
    minYieldBps: pct(6),
    maxCompletionDays: 60,
    acceptableStructures: ["cash-purchase"],
    minDealScore: 55,
    active: true,
    ...overrides,
  };
}

function dealRecord(): DealRecord {
  return {
    id: "deal-contract-1",
    reference: "LODE-TEST",
    createdAt: "2026-08-01T00:00:00.000Z",
    property: {
      id: "p1",
      jurisdiction: "GB-ENG",
      postcodeArea: "B23",
      locality: "Erdington",
      propertyType: "house",
      tenure: "freehold",
      bedrooms: 3,
      occupancy: "vacant",
      openMarketValue: fromMajor(212_000),
      valuationConfidence: pct(80),
      refurbishmentEstimate: fromMajor(34_000),
      postWorksValue: fromMajor(285_000),
      monthlyRent: fromMajor(1_250),
      knownIssues: [],
    },
    seller: { situation: "probate", priorities: ["speed"] },
    inputs: {
      property: {
        id: "p1",
        jurisdiction: "GB-ENG",
        postcodeArea: "B23",
        locality: "Erdington",
        propertyType: "house",
        tenure: "freehold",
        bedrooms: 3,
        occupancy: "vacant",
        openMarketValue: fromMajor(212_000),
        valuationConfidence: pct(80),
        refurbishmentEstimate: fromMajor(34_000),
        postWorksValue: fromMajor(285_000),
        monthlyRent: fromMajor(1_250),
        knownIssues: [],
      },
      seller: { situation: "probate", priorities: ["speed"] },
      purchasePrice: fromMajor(172_000),
      buyerOwnsOtherProperty: true,
      buyerIsCompany: true,
      buyerIsNonResident: false,
      holdMonths: 9,
      structure: "cash-purchase",
      finance: {
        ltvBps: pct(0),
        refurbAdvanceBps: pct(0),
        annualRateBps: pct(0),
        arrangementFeeBps: pct(0),
        exitFeeBps: pct(0),
        interestRolledUp: false,
        lenderCosts: fromMajor(0),
      },
      exit: "sell",
    },
    borrowerCompletedDeals: 2,
    status: "new",
  };
}

function contract(name: string, load: () => Promise<Store>, reset: () => Promise<void>): void {
  describe(`${name} store`, () => {
    let store: Store;

    beforeAll(async () => {
      store = await load();
    });

    beforeEach(async () => {
      await reset();
    });

    it("round-trips a deal without changing it", async () => {
      // Money is an integer count of pence; a store that returns a float here
      // would corrupt every figure downstream while still looking plausible.
      const deal = dealRecord();
      await store.saveDeal(deal);
      const loaded = await store.getDeal(deal.id);
      expect(loaded).toEqual(deal);
      expect(loaded?.property.openMarketValue).toBe(fromMajor(212_000));
    });

    it("updates rather than duplicates on a second save", async () => {
      await store.saveDeal(dealRecord());
      await store.saveDeal({ ...dealRecord(), status: "qualified" });
      const all = await store.listDeals();
      expect(all).toHaveLength(1);
      expect(all[0]?.status).toBe("qualified");
    });

    it("returns undefined for an unknown id rather than throwing", async () => {
      expect(await store.getDeal("nope")).toBeUndefined();
      expect(await store.getBuyBox("nope")).toBeUndefined();
      expect(await store.getFundingBox("nope")).toBeUndefined();
    });

    it("deletes a buy box and reports whether anything was removed", async () => {
      await store.saveBuyBox(buyBox());
      expect(await store.deleteBuyBox("buy-1")).toBe(true);
      expect(await store.deleteBuyBox("buy-1")).toBe(false);
      expect(await store.listBuyBoxes()).toHaveLength(0);
    });

    it("upserts a subscriber by email, never by id", async () => {
      // A second signup for the same address must not create a second record,
      // or the person is mailed twice and unsubscribing removes only half.
      await store.saveSubscriber(subscriber());
      await store.saveSubscriber(subscriber({ id: "sub-2", status: "confirmed" }));
      const all = await store.listSubscribers();
      expect(all).toHaveLength(1);
      expect(all[0]?.status).toBe("confirmed");
    });

    it("finds and updates a subscriber by token", async () => {
      await store.saveSubscriber(subscriber());
      const updated = await store.updateSubscriberByToken("confirmToken", "confirm-1", (s) => ({
        ...s,
        status: "confirmed",
      }));
      expect(updated?.status).toBe("confirmed");
      expect((await store.findSubscriberByEmail("someone@example.com"))?.status).toBe("confirmed");
    });

    it("returns undefined for an unknown token without writing anything", async () => {
      await store.saveSubscriber(subscriber());
      expect(await store.updateSubscriberByToken("confirmToken", "wrong", (s) => s)).toBeUndefined();
      expect((await store.findSubscriberByEmail("someone@example.com"))?.status).toBe("pending");
    });

    it("stamps an issue once, so a second run sends to nobody", async () => {
      // This is the idempotency the cron endpoint depends on: a scheduler that
      // fires twice, or a manual re-run after a partial failure, must not mail
      // the same person the same issue again.
      await store.saveSubscriber(subscriber({ status: "confirmed" }));
      expect(await store.markIssueSent(["sub-1"], "2026-W33")).toBe(1);
      expect(await store.markIssueSent(["sub-1"], "2026-W33")).toBe(0);
      expect(await store.markIssueSent(["sub-1"], "2026-W34")).toBe(1);
    });

    it("marks nothing for an empty id list", async () => {
      expect(await store.markIssueSent([], "2026-W33")).toBe(0);
    });

    it("keeps subscribers through a reseed", async () => {
      // Subscribers are consent records. Wiping them on reseed would destroy
      // the evidence of why an address was mailed.
      await store.saveSubscriber(subscriber({ status: "confirmed" }));
      await store.replaceAll({ deals: [dealRecord()], buyBoxes: [], fundingBoxes: [], subscribers: [], accounts: [], auditEvents: [], blogViews: [], subscriptions: [], creditLots: [], ledgerEntries: [], billingEvents: [], discoveryCandidates: [], outreachMessages: [], suppressions: [], dataRoomGrants: [], agentDecisions: [], pendingCharges: [] });
      expect(await store.listSubscribers()).toHaveLength(1);
      expect(await store.listDeals()).toHaveLength(1);
    });

    it("reports emptiness from deals and boxes, not from subscribers", async () => {
      expect(await store.isEmpty()).toBe(true);
      await store.saveSubscriber(subscriber());
      expect(await store.isEmpty()).toBe(true);
      await store.saveDeal(dealRecord());
      expect(await store.isEmpty()).toBe(false);
    });


    describe("agent decisions", () => {
      const decision = {
        id: "dec-1",
        dealId: "deal-1",
        agentId: "terms" as const,
        proposalKey: "terms:cheapest:off-1",
        decision: "accepted" as const,
        byAccountId: "acc-1",
        byName: "Jo Bloggs",
        note: "Cheapest in total.",
        at: "2026-08-30T09:00:00.000Z",
        proposalHeadline: "Example Bridging is cheapest in total",
        effect: "record-selection" as const,
      };

      it("round-trips a decision and scopes it to its deal", async () => {
        await store.saveAgentDecision(decision);
        await store.saveAgentDecision({ ...decision, id: "dec-2", dealId: "deal-2" });
        const mine = await store.listAgentDecisions("deal-1");
        expect(mine).toHaveLength(1);
        expect(mine[0]).toEqual(decision);
        expect(await store.listAgentDecisions("deal-3")).toHaveLength(0);
      });

      it("appends a change of mind rather than replacing it, newest first", async () => {
        await store.saveAgentDecision(decision);
        await store.saveAgentDecision({
          ...decision,
          id: "dec-2",
          decision: "dismissed",
          at: "2026-08-31T09:00:00.000Z",
        });
        const all = await store.listAgentDecisions("deal-1");
        expect(all).toHaveLength(2);
        expect(all[0]?.id).toBe("dec-2");
      });
    });

    describe("billing: money that must move exactly once", () => {
      const at = "2026-08-01T00:00:00.000Z";
      const later = "2026-08-01T00:05:00.000Z";

      const topUp = (overrides: Record<string, unknown> = {}) => ({
        accountId: "acc-1",
        idempotencyKey: "pay_abc",
        at,
        purchased: {
          lotId: "lot-1",
          amount: fromMajor(100),
          cashGross: fromMajor(100),
          cashTax: fromMajor(16.67),
          expiresAt: "2027-08-01T00:00:00.000Z",
        },
        paymentReference: "pay_abc",
        entryIdPrefix: "e1",
        reason: "Top-up",
        ...overrides,
      });

      it("applies a top-up once, however many times the provider delivers it", async () => {
        // Providers redeliver on timeout by design. Applying the second
        // delivery hands over the balance a second time for one payment.
        const first = await store.applyTopUp(topUp());
        const second = await store.applyTopUp(topUp());

        expect(first).toMatchObject({ applied: true, duplicate: false, balance: fromMajor(100) });
        expect(second).toMatchObject({ applied: false, duplicate: true, balance: fromMajor(100) });
        expect(await store.listCreditLots("acc-1")).toHaveLength(1);
      });

      it("keeps a bonus in its own lot, with no cash behind it", async () => {
        await store.applyTopUp(
          topUp({
            granted: { lotId: "lot-2", amount: fromMajor(10), expiresAt: "2026-11-01T00:00:00.000Z" },
          }),
        );

        const lots = await store.listCreditLots("acc-1");
        const granted = lots.find((l) => l.kind === "granted");
        expect(lots).toHaveLength(2);
        expect(granted?.cashGross).toBe(0);
        expect(await store.listLedgerEntries("acc-1")).toHaveLength(2);
      });

      it("refuses a spend it cannot cover, and changes nothing", async () => {
        await store.applyTopUp(topUp({ purchased: { ...topUp().purchased, amount: fromMajor(5), cashGross: fromMajor(5), cashTax: 0 } }));

        const result = await store.spendCredits({
          accountId: "acc-1",
          idempotencyKey: "op-1",
          at: later,
          amount: fromMajor(9),
          entryIdPrefix: "s1",
          reference: "ai-deal-analysis",
          reason: "Analysis",
        });

        expect(result.ok).toBe(false);
        expect(result.shortfall).toBe(fromMajor(4));
        expect(result.balance).toBe(fromMajor(5));
        expect(await store.listLedgerEntries("acc-1")).toHaveLength(1);
      });

      it("charges once for a retried operation", async () => {
        await store.applyTopUp(topUp());
        const spend = {
          accountId: "acc-1",
          idempotencyKey: "op-1",
          at: later,
          amount: fromMajor(10),
          entryIdPrefix: "s1",
          reference: "ai-deal-analysis",
          reason: "Analysis",
        };

        await store.spendCredits(spend);
        const retry = await store.spendCredits(spend);

        expect(retry.duplicate).toBe(true);
        expect(retry.balance).toBe(fromMajor(90));
      });

      it("cannot be made to overspend by simultaneous requests", async () => {
        // The reason the read and the write are one operation. Twenty-five
        // requests against ten pounds of balance: exactly ten may succeed.
        await store.applyTopUp(
          topUp({ purchased: { ...topUp().purchased, amount: fromMajor(10), cashGross: fromMajor(10), cashTax: 0 } }),
        );

        const attempts = await Promise.all(
          Array.from({ length: 25 }, (_, i) =>
            store.spendCredits({
              accountId: "acc-1",
              idempotencyKey: `op-${i}`,
              at: later,
              amount: fromMajor(1),
              entryIdPrefix: `s${i}`,
              reference: "ai-deal-analysis",
              reason: "Analysis",
            }),
          ),
        );

        expect(attempts.filter((a) => a.ok).length).toBe(10);
        const lots = await store.listCreditLots("acc-1");
        expect(lots[0]?.remaining).toBe(0);
        expect(availableBalance(lots, new Date(later))).toBe(0);
      });

      it("never lets a balance go below zero", async () => {
        await store.applyTopUp(
          topUp({ purchased: { ...topUp().purchased, amount: fromMajor(3), cashGross: fromMajor(3), cashTax: 0 } }),
        );
        await Promise.all(
          Array.from({ length: 10 }, (_, i) =>
            store.spendCredits({
              accountId: "acc-1",
              idempotencyKey: `op-${i}`,
              at: later,
              amount: fromMajor(1),
              entryIdPrefix: `s${i}`,
              reference: "op",
              reason: "op",
            }),
          ),
        );

        for (const lot of await store.listCreditLots("acc-1")) {
          expect(lot.remaining).toBeGreaterThanOrEqual(0);
        }
      });

      it("takes back the whole lot on a dispute, spent or not", async () => {
        // The money came back out in full, so the reversal is in full. What was
        // already consumed is a loss, and it has to be visible as one.
        await store.applyTopUp(topUp());
        await store.spendCredits({
          accountId: "acc-1",
          idempotencyKey: "op-1",
          at: later,
          amount: fromMajor(70),
          entryIdPrefix: "s1",
          reference: "op",
          reason: "op",
        });

        const result = await store.reverseLotsForPayment({
          paymentReference: "pay_abc",
          refundedGross: "full",
          kind: "chargeback",
          at: later,
          entryIdPrefix: "cb1",
        });
        expect(result.lotsReversed).toBe(1);
        expect(result.debt).toBe(fromMajor(70));

        const lots = await store.listCreditLots("acc-1");
        const entries = await store.listLedgerEntries("acc-1");
        expect(lots[0]?.voidedAt).toBeDefined();
        expect(availableBalance(lots, new Date(later))).toBe(0);

        const position = standing(lots, entries, new Date(later));
        expect(position.owed).toBe(fromMajor(70));
        expect(position.maySpend).toBe(false);
      });

      it("takes only what a partial refund paid for, leaving the rest spendable", async () => {
        // Stripping balance a customer still owns is the fastest way to turn a
        // refund into a dispute.
        await store.applyTopUp(topUp());

        const result = await store.reverseLotsForPayment({
          paymentReference: "pay_abc",
          refundedGross: fromMajor(40),
          kind: "refund",
          at: later,
          entryIdPrefix: "rf1",
        });

        expect(result.balanceRemoved).toBe(fromMajor(40));
        expect(result.debt).toBe(0);

        const lots = await store.listCreditLots("acc-1");
        expect(lots[0]?.voidedAt).toBeUndefined();
        expect(availableBalance(lots, new Date(later))).toBe(fromMajor(60));
      });

      it("counts a plan allowance up to its limit and no further", async () => {
        const use = (item: string) =>
          store.recordAllowanceUse({
            accountId: "acc-1",
            idempotencyKey: `memo:acc-1:${item}:${at}`,
            at: later,
            periodStart: at,
            limit: 2,
            entryId: `al-${item}`,
            reference: item,
            reason: "memorandum",
          });

        expect((await use("deal-1")).allowed).toBe(true);
        expect((await use("deal-2")).allowed).toBe(true);
        const third = await use("deal-3");
        expect(third.allowed).toBe(false);
        expect(third.used).toBe(2);
      });

      it("does not charge twice for reopening the same item", async () => {
        const once = {
          accountId: "acc-1",
          idempotencyKey: "memo:acc-1:deal-1",
          at: later,
          periodStart: at,
          limit: 1,
          entryId: "al-1",
          reference: "deal-1",
          reason: "memorandum",
        };
        expect((await store.recordAllowanceUse(once)).allowed).toBe(true);
        const again = await store.recordAllowanceUse({ ...once, entryId: "al-2" });
        expect(again.allowed).toBe(true);
        expect(again.duplicate).toBe(true);
      });

      it("cannot be raced past its allowance limit", async () => {
        // Two simultaneous opens must not both see the count below the limit.
        const attempts = await Promise.all(
          Array.from({ length: 10 }, (_, i) =>
            store.recordAllowanceUse({
              accountId: "acc-1",
              idempotencyKey: `memo:acc-1:deal-${i}`,
              at: later,
              periodStart: at,
              limit: 3,
              entryId: `al-${i}`,
              reference: `deal-${i}`,
              reason: "memorandum",
            }),
          ),
        );
        expect(attempts.filter((a) => a.allowed).length).toBe(3);
      });

      it("records a note once, however often it is retried", async () => {
        const note = {
          accountId: "acc-1",
          idempotencyKey: "fee:pay_abc",
          at: later,
          kind: "fee" as const,
          amount: -fromMajor(15) as never,
          entryId: "fee-1",
          reason: "Dispute fee.",
        };
        expect(await store.recordNote(note)).toBe(true);
        expect(await store.recordNote({ ...note, entryId: "fee-2" })).toBe(false);
        expect((await store.listLedgerEntries("acc-1")).filter((e) => e.kind === "fee")).toHaveLength(1);
      });

      it("writes off lapsed balance with an entry rather than silently", async () => {
        await store.applyTopUp(
          topUp({ purchased: { ...topUp().purchased, expiresAt: "2026-08-02T00:00:00.000Z" } }),
        );

        const expired = await store.expireLapsedCredits("2026-09-01T00:00:00.000Z", "x1");
        expect(expired).toBe(1);

        const entries = await store.listLedgerEntries("acc-1");
        expect(entries.some((e) => e.kind === "expire" && e.amount === -fromMajor(100))).toBe(true);
        expect(availableBalance(await store.listCreditLots("acc-1"), new Date("2026-09-01"))).toBe(0);
      });

      it("hands a provider event to exactly one caller", async () => {
        const claims = await Promise.all(
          Array.from({ length: 5 }, () => store.claimBillingEvent("evt_1", "payment.succeeded", at)),
        );
        expect(claims.filter(Boolean)).toHaveLength(1);
      });

      it("keeps one account's balance out of another's", async () => {
        await store.applyTopUp(topUp());
        await store.applyTopUp(
          topUp({ accountId: "acc-2", idempotencyKey: "pay_def", paymentReference: "pay_def", entryIdPrefix: "e2", purchased: { ...topUp().purchased, lotId: "lot-9" } }),
        );

        expect(await store.listCreditLots("acc-1")).toHaveLength(1);
        expect(await store.listLedgerEntries("acc-2")).toHaveLength(1);
      });

      it("stores and returns a subscription unchanged", async () => {
        const subscription = {
          id: "sub-1",
          accountId: "acc-1",
          planId: "buyer-professional" as const,
          status: "active" as const,
          currentPeriodStart: at,
          currentPeriodEnd: "2026-09-01T00:00:00.000Z",
        };
        await store.saveSubscription(subscription);
        expect(await store.getSubscription("acc-1")).toEqual(subscription);
      });
    });

    describe("blog view counts", () => {
      it("starts at one and climbs", async () => {
        expect(await store.recordBlogView("a-post", "2026-08-01T00:00:00.000Z")).toMatchObject({
          slug: "a-post",
          views: 1,
        });
        expect(await store.recordBlogView("a-post", "2026-08-01T00:01:00.000Z")).toMatchObject({
          views: 2,
        });
      });

      it("counts each post separately", async () => {
        await store.recordBlogView("a-post", "2026-08-01T00:00:00.000Z");
        await store.recordBlogView("a-post", "2026-08-01T00:00:00.000Z");
        await store.recordBlogView("b-post", "2026-08-01T00:00:00.000Z");

        const views = await store.listBlogViews();
        expect(views.find((v) => v.slug === "a-post")?.views).toBe(2);
        expect(views.find((v) => v.slug === "b-post")?.views).toBe(1);
      });

      it("loses no count when views arrive at the same time", async () => {
        // The whole reason both engines increment atomically rather than reading,
        // adding one and writing back. A read-modify-write drops most of these.
        await Promise.all(
          Array.from({ length: 25 }, () => store.recordBlogView("busy", "2026-08-01T00:00:00.000Z")),
        );

        const busy = (await store.listBlogViews()).find((v) => v.slug === "busy");
        expect(busy?.views).toBe(25);
      });

      it("returns the most-read post first", async () => {
        await store.recordBlogView("quiet", "2026-08-01T00:00:00.000Z");
        for (let i = 0; i < 3; i += 1) {
          await store.recordBlogView("loud", "2026-08-01T00:00:00.000Z");
        }

        expect((await store.listBlogViews())[0]?.slug).toBe("loud");
      });

      it("records when a post was last opened", async () => {
        await store.recordBlogView("a-post", "2026-08-01T00:00:00.000Z");
        await store.recordBlogView("a-post", "2026-08-02T09:30:00.000Z");

        const row = (await store.listBlogViews()).find((v) => v.slug === "a-post");
        expect(row?.lastViewedAt).toBe("2026-08-02T09:30:00.000Z");
      });

      it("reports nothing for a post nobody has opened", async () => {
        expect(await store.listBlogViews()).toEqual([]);
      });
    });
  });

}

// A scratch file, so the suite does not truncate the developer's own seeded
// store. replaceAll cannot clear subscribers by design — they are consent
// records — so the only honest reset is a fresh file.
const SCRATCH = mkdtempSync(path.join(tmpdir(), "lode-store-"));
process.env.LODE_DATA_FILE = path.join(SCRATCH, "lode.json");

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

contract(
  "file",
  async () => fileStore,
  async () => {
    // Queue through the write chain first. Deleting the file outright would
    // race a write still in flight from the previous test, which would then
    // land after the delete and recreate it.
    await fileStore.replaceAll({ deals: [], buyBoxes: [], fundingBoxes: [], subscribers: [], accounts: [], auditEvents: [], blogViews: [], subscriptions: [], creditLots: [], ledgerEntries: [], billingEvents: [], discoveryCandidates: [], outreachMessages: [], suppressions: [], dataRoomGrants: [], agentDecisions: [], pendingCharges: [] });
    rmSync(process.env.LODE_DATA_FILE ?? "", { force: true });
  },
);

if (TEST_URL === undefined || TEST_URL === "") {
  describe.skip("postgres store (set TEST_DATABASE_URL to run)", () => {
    it("is skipped", () => undefined);
  });
} else {
  process.env.DATABASE_URL = TEST_URL;

  const { postgresStore, closePostgres } = await import("@backend/store/postgresStore");
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: TEST_URL });

  afterAll(async () => {
    await closePostgres();
    await pool.end();
  });

  contract(
    "postgres",
    async () => postgresStore,
    async () => {
      // Truncate rather than replaceAll: the reset has to be unconditional,
      // including the subscribers replaceAll is required to preserve.
      await postgresStore.listDeals().catch(() => undefined); // ensures the schema exists
      await pool.query(
        "TRUNCATE deals, buy_boxes, funding_boxes, subscribers RESTART IDENTITY CASCADE",
      );
    },
  );
}

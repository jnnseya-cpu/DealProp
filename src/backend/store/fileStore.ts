import { promises as fs } from "node:fs";
import path from "node:path";
import type { BuyBox, FundingBox } from "@shared/domain/matching";
import type { Subscriber } from "@shared/domain/newsletter";
import type { Account } from "@shared/domain/accounts";
import type { AgentDecision } from "@shared/domain/agents";
import type { DealFee, PayoutRecord, RevealRecord, StoredComparableBundle, StoredAuctionLot } from "@backend/store/schema";
import type { PayoutRecipient } from "@shared/domain/payouts";
import type { RefundTrigger } from "@shared/domain/reveal";
import type { IntakeConversation } from "@shared/domain/intakeConversation";
import type { AgentRunRecord } from "@shared/domain/agentRun";
import type { OperatorTask } from "@shared/domain/operatorTask";
import type { DealHuntQuery, DealHuntRun, DealHuntResult } from "@shared/domain/dealHuntRun";
import type { EvidenceClaim } from "@shared/domain/evidenceClaim";
import type { DecisionSnapshot } from "@shared/domain/decisionSnapshot";
import type { ComparisonRun } from "@shared/domain/comparison";
import type { WatchCursor } from "@shared/domain/watchCursor";
import type { LayoutHypothesis } from "@shared/domain/floorplan";
import type { PricePaidSale } from "@backend/sources/pricePaidBulk";
import { add, money, sub, ZERO, type Money } from "@shared/money";
import {
  dueForExpiry,
  planSpend,
  availableBalance,
  reversalImpact,
  reversalShare,
  type CreditLot,
  type LedgerEntry,
} from "@shared/domain/ledger";
import type { Subscription } from "@shared/domain/entitlements";
import type {
  AccountImage,
  AllowanceInput,
  AllowanceResult,
  AuditEvent,
  DealImage,
  BlogViewCount,
  ImageKind,
  NoteInput,
  ReversalInput,
  ReversalResult,
  SpendInput,
  SpendResult,
  DataRoomGrant,
  OutreachMessage,
  PendingCharge,
  StoredCandidate,
  StoredSourcedProperty,
  ContactedLead,
  StoredImportedListing,
  StoredNotification,
  Suppression,
  TopUpInput,
  TopUpResult,
  Database,
  DealRecord,
  Store,
  SubscriberTokenField,
} from "@backend/store/schema";

/**
 * File-backed store.
 *
 * Writes serialise through a promise chain and go via a temporary file plus
 * rename, so a crash mid-write cannot leave a truncated store behind.
 *
 * This is adequate for a single-process development server and nothing more.
 * It is actively wrong on serverless hosting, where each instance has its own
 * ephemeral, usually read-only filesystem: two requests can land on different
 * instances and neither sees the other's writes. `postgresStore.ts` is what
 * runs anywhere real; this is what runs with no configuration at all.
 */

/**
 * Where the file lives.
 *
 * Overridable so the contract tests can point at a scratch file instead of the
 * developer's own seeded store, which they would otherwise have to truncate.
 */
function dataFile(): string {
  return process.env.LODE_DATA_FILE ?? path.join(process.cwd(), ".data", "lode.json");
}

/**
 * A fresh empty database, built per call rather than spread from a shared
 * constant.
 *
 * `{ ...EMPTY }` is a shallow copy: the arrays inside it stay shared, so a
 * write against a store whose file does not exist yet pushes into the constant
 * itself and every later "empty" read starts with the leftovers. This is a
 * function for that reason; do not turn it back into a spread.
 */
function emptyDatabase(): Database {
  return {
    deals: [],
    buyBoxes: [],
    fundingBoxes: [],
    subscribers: [],
    accounts: [],
    accountImages: [],
    dealImages: [],
    notifications: [],
    auditEvents: [],
    blogViews: [],
    subscriptions: [],
    creditLots: [],
    ledgerEntries: [],
    billingEvents: [],
    discoveryCandidates: [],
    sourcedProperties: [],
    importedListings: [],
    contactedLeads: [],
    outreachMessages: [],
    intakeConversations: [],
    agentRuns: [],
    operatorTasks: [],
    dealHuntQueries: [],
    dealHuntRuns: [],
    dealHuntResults: [],
    comparableBundles: [],
    pricePaidSales: [],
    evidenceClaims: [],
    decisionSnapshots: [],
    comparisonRuns: [],
    watchCursors: [],
    layoutHypotheses: [],
    auctionLots: [],
    suppressions: [],
    dataRoomGrants: [],
    agentDecisions: [],
    dealFees: [],
    reveals: [],
    payoutRecipients: [],
    payouts: [],
    pendingCharges: [],
  };
}

let writeChain: Promise<unknown> = Promise.resolve();

async function readDatabase(): Promise<Database> {
  try {
    const raw = await fs.readFile(dataFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Database>;
    return {
      deals: parsed.deals ?? [],
      buyBoxes: parsed.buyBoxes ?? [],
      fundingBoxes: parsed.fundingBoxes ?? [],
      subscribers: parsed.subscribers ?? [],
      accounts: parsed.accounts ?? [],
      accountImages: parsed.accountImages ?? [],
      dealImages: parsed.dealImages ?? [],
      notifications: parsed.notifications ?? [],
      auditEvents: parsed.auditEvents ?? [],
      // Absent in any store written before view counting existed. Defaulted
      // rather than migrated: an unread post and a post nobody has counted yet
      // are the same number.
      blogViews: parsed.blogViews ?? [],
      subscriptions: parsed.subscriptions ?? [],
      creditLots: parsed.creditLots ?? [],
      ledgerEntries: parsed.ledgerEntries ?? [],
      billingEvents: parsed.billingEvents ?? [],
      discoveryCandidates: parsed.discoveryCandidates ?? [],
      // Absent in any store written before the sourcing worklist existed.
      sourcedProperties: parsed.sourcedProperties ?? [],
      importedListings: parsed.importedListings ?? [],
      contactedLeads: parsed.contactedLeads ?? [],
      outreachMessages: parsed.outreachMessages ?? [],
      // Absent in any store written before the intake assistant existed.
      intakeConversations: parsed.intakeConversations ?? [],
      // Absent in any store written before the agent-run ledger existed.
      agentRuns: parsed.agentRuns ?? [],
      // Absent in any store written before the operator worklist existed.
      operatorTasks: parsed.operatorTasks ?? [],
      // Absent in any store written before Deal Hunt existed.
      dealHuntQueries: parsed.dealHuntQueries ?? [],
      dealHuntRuns: parsed.dealHuntRuns ?? [],
      dealHuntResults: parsed.dealHuntResults ?? [],
      comparableBundles: parsed.comparableBundles ?? [],
      pricePaidSales: parsed.pricePaidSales ?? [],
      evidenceClaims: parsed.evidenceClaims ?? [],
      decisionSnapshots: parsed.decisionSnapshots ?? [],
      comparisonRuns: parsed.comparisonRuns ?? [],
      watchCursors: parsed.watchCursors ?? [],
      layoutHypotheses: parsed.layoutHypotheses ?? [],
      auctionLots: parsed.auctionLots ?? [],
      suppressions: parsed.suppressions ?? [],
      dataRoomGrants: parsed.dataRoomGrants ?? [],
      agentDecisions: parsed.agentDecisions ?? [],
      dealFees: parsed.dealFees ?? [],
      reveals: parsed.reveals ?? [],
      payoutRecipients: parsed.payoutRecipients ?? [],
      payouts: parsed.payouts ?? [],
      pendingCharges: parsed.pendingCharges ?? [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyDatabase();
    }
    throw error;
  }
}

async function writeDatabase(db: Database): Promise<void> {
  const file = dataFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(temp, file);
}

/** Serialise a read-modify-write so concurrent requests cannot clobber. */
function mutate<T>(fn: (db: Database) => Promise<T> | T): Promise<T> {
  const next = writeChain.then(async () => {
    const db = await readDatabase();
    const result = await fn(db);
    await writeDatabase(db);
    return result;
  });
  // Keep the chain alive even if this mutation rejects, so one failed write
  // does not deadlock every subsequent one.
  writeChain = next.catch(() => undefined);
  return next;
}

async function listDeals(): Promise<readonly DealRecord[]> {
  const db = await readDatabase();
  return db.deals;
}

async function listDealsForOwner(ownerAccountId: string): Promise<readonly DealRecord[]> {
  const db = await readDatabase();
  return db.deals
    .filter((d) => d.ownerAccountId === ownerAccountId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function pageDeals(
  limit: number,
  offset: number,
): Promise<{ readonly rows: readonly DealRecord[]; readonly total: number }> {
  const db = await readDatabase();
  // Newest first, matching the Postgres engine. The file store has no index to
  // lean on, so the sort is done here and the contract suite holds the two to
  // the same order.
  const sorted = [...db.deals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { rows: sorted.slice(offset, offset + limit), total: sorted.length };
}

async function getDeal(id: string): Promise<DealRecord | undefined> {
  const db = await readDatabase();
  return db.deals.find((d) => d.id === id);
}

async function saveDeal(deal: DealRecord): Promise<DealRecord> {
  return mutate((db) => {
    const index = db.deals.findIndex((d) => d.id === deal.id);
    if (index >= 0) db.deals[index] = deal;
    else db.deals.push(deal);
    return deal;
  });
}

async function deleteDeal(id: string): Promise<boolean> {
  return mutate((db) => {
    const before = db.deals.length;
    db.deals = db.deals.filter((d) => d.id !== id);
    return db.deals.length < before;
  });
}

async function listBuyBoxes(): Promise<readonly BuyBox[]> {
  const db = await readDatabase();
  return db.buyBoxes;
}

async function saveBuyBox(box: BuyBox): Promise<BuyBox> {
  return mutate((db) => {
    const index = db.buyBoxes.findIndex((b) => b.id === box.id);
    if (index >= 0) db.buyBoxes[index] = box;
    else db.buyBoxes.push(box);
    return box;
  });
}

async function getBuyBox(id: string): Promise<BuyBox | undefined> {
  const db = await readDatabase();
  return db.buyBoxes.find((b) => b.id === id);
}

/** Returns true where a box existed and was removed. */
async function deleteBuyBox(id: string): Promise<boolean> {
  return mutate((db) => {
    const index = db.buyBoxes.findIndex((b) => b.id === id);
    if (index < 0) return false;
    db.buyBoxes.splice(index, 1);
    return true;
  });
}

async function listFundingBoxes(): Promise<readonly FundingBox[]> {
  const db = await readDatabase();
  return db.fundingBoxes;
}

async function saveFundingBox(box: FundingBox): Promise<FundingBox> {
  return mutate((db) => {
    const index = db.fundingBoxes.findIndex((b) => b.id === box.id);
    if (index >= 0) db.fundingBoxes[index] = box;
    else db.fundingBoxes.push(box);
    return box;
  });
}

async function getFundingBox(id: string): Promise<FundingBox | undefined> {
  const db = await readDatabase();
  return db.fundingBoxes.find((b) => b.id === id);
}

/** Returns true where a box existed and was removed. */
async function deleteFundingBox(id: string): Promise<boolean> {
  return mutate((db) => {
    const index = db.fundingBoxes.findIndex((b) => b.id === id);
    if (index < 0) return false;
    db.fundingBoxes.splice(index, 1);
    return true;
  });
}

async function replaceAll(db: Database): Promise<void> {
  await mutate((current) => {
    current.deals = db.deals;
    current.buyBoxes = db.buyBoxes;
    current.fundingBoxes = db.fundingBoxes;
    // Subscribers are consent records and survive a reseed. Wiping them would
    // destroy the evidence of consent and silently re-enrol nobody, leaving
    // the platform unable to prove why an address was mailed.
    if (db.subscribers.length > 0) current.subscribers = db.subscribers;
    // Accounts and the audit trail survive a reseed for the same reason
    // subscribers do: they are evidence, and a reseed is a development
    // convenience that must not destroy it.
    if (db.accounts.length > 0) current.accounts = db.accounts;
    if (db.auditEvents.length > 0) current.auditEvents = db.auditEvents;
    if (db.blogViews.length > 0) current.blogViews = db.blogViews;
    // Billing records are never replaced by a reseed. The ledger is the record
    // of money that actually moved, and a development convenience must not be
    // able to rewrite it — the Postgres engine cannot either, because its
    // replaceAll does not touch these tables at all.
    if (db.subscriptions.length > 0) current.subscriptions = db.subscriptions;
    if (db.creditLots.length > 0) current.creditLots = db.creditLots;
    if (db.ledgerEntries.length > 0) current.ledgerEntries = db.ledgerEntries;
    if (db.billingEvents.length > 0) current.billingEvents = db.billingEvents;
  });
}

// --- Subscribers -----------------------------------------------------------

async function listSubscribers(): Promise<readonly Subscriber[]> {
  const db = await readDatabase();
  return db.subscribers;
}

async function findSubscriberByEmail(email: string): Promise<Subscriber | undefined> {
  const db = await readDatabase();
  return db.subscribers.find((s) => s.email === email);
}

/**
 * Upsert by email.
 *
 * Email is the natural key: a second signup for an address that already exists
 * must update that record rather than create a duplicate, or one person ends
 * up receiving the newsletter twice and unsubscribing only half of themselves.
 */
async function saveSubscriber(subscriber: Subscriber): Promise<Subscriber> {
  return mutate((db) => {
    const index = db.subscribers.findIndex((s) => s.email === subscriber.email);
    if (index >= 0) db.subscribers[index] = subscriber;
    else db.subscribers.push(subscriber);
    return subscriber;
  });
}

/**
 * Apply a change to a subscriber found by token, atomically.
 *
 * Confirmation and unsubscribe both arrive as URLs that may be clicked twice
 * (mail clients prefetch links). Doing the lookup and the write inside one
 * mutation keeps the second click from racing the first.
 */
async function updateSubscriberByToken(
  field: SubscriberTokenField,
  token: string,
  change: (current: Subscriber) => Subscriber,
): Promise<Subscriber | undefined> {
  return mutate((db) => {
    const index = db.subscribers.findIndex((s) => s[field] === token);
    if (index < 0) return undefined;
    const current = db.subscribers[index];
    if (current === undefined) return undefined;
    const next = change(current);
    db.subscribers[index] = next;
    return next;
  });
}

/** Record that an issue was sent, so a re-run cannot send it twice. */
async function markIssueSent(ids: readonly string[], weekKey: string): Promise<number> {
  return mutate((db) => {
    let updated = 0;
    for (let i = 0; i < db.subscribers.length; i += 1) {
      const s = db.subscribers[i];
      if (s !== undefined && ids.includes(s.id) && s.lastSentWeek !== weekKey) {
        db.subscribers[i] = { ...s, lastSentWeek: weekKey };
        updated += 1;
      }
    }
    return updated;
  });
}

/** True when the store has never been seeded. */
async function isEmpty(): Promise<boolean> {
  const db = await readDatabase();
  return db.deals.length === 0 && db.buyBoxes.length === 0 && db.fundingBoxes.length === 0;
}

async function listAccounts(): Promise<readonly Account[]> {
  const db = await readDatabase();
  return db.accounts;
}

async function getAccount(id: string): Promise<Account | undefined> {
  const db = await readDatabase();
  return db.accounts.find((a) => a.id === id);
}

async function findAccountByEmail(email: string): Promise<Account | undefined> {
  const db = await readDatabase();
  const wanted = email.trim().toLowerCase();
  return db.accounts.find((a) => a.email.toLowerCase() === wanted);
}

async function saveAccount(account: Account): Promise<Account> {
  return mutate((db) => {
    const index = db.accounts.findIndex((a) => a.id === account.id);
    if (index >= 0) db.accounts[index] = account;
    else db.accounts.push(account);
    return account;
  });
}

async function getAccountImage(
  accountId: string,
  kind: ImageKind,
): Promise<AccountImage | undefined> {
  const db = await readDatabase();
  return (db.accountImages ?? []).find((i) => i.id === `${accountId}:${kind}`);
}

async function saveAccountImage(image: AccountImage): Promise<AccountImage> {
  return mutate((db) => {
    const images = (db.accountImages ??= []);
    const index = images.findIndex((i) => i.id === image.id);
    if (index >= 0) images[index] = image;
    else images.push(image);
    return image;
  });
}

async function deleteAccountImage(accountId: string, kind: ImageKind): Promise<boolean> {
  return mutate((db) => {
    const images = (db.accountImages ??= []);
    const id = `${accountId}:${kind}`;
    const before = images.length;
    db.accountImages = images.filter((i) => i.id !== id);
    return db.accountImages.length < before;
  });
}

async function getDealImage(dealId: string, position: number): Promise<DealImage | undefined> {
  const db = await readDatabase();
  return (db.dealImages ?? []).find((i) => i.id === `${dealId}:${position}`);
}

async function listDealImages(dealId: string): Promise<readonly DealImage[]> {
  const db = await readDatabase();
  return (db.dealImages ?? [])
    .filter((i) => i.dealId === dealId)
    .sort((a, b) => a.position - b.position);
}

async function saveDealImage(image: DealImage): Promise<DealImage> {
  return mutate((db) => {
    const images = (db.dealImages ??= []);
    const index = images.findIndex((i) => i.id === image.id);
    if (index >= 0) images[index] = image;
    else images.push(image);
    return image;
  });
}

async function deleteDealImage(dealId: string, position: number): Promise<boolean> {
  return mutate((db) => {
    const images = (db.dealImages ??= []);
    const id = `${dealId}:${position}`;
    const before = images.length;
    db.dealImages = images.filter((i) => i.id !== id);
    return db.dealImages.length < before;
  });
}

async function recordNotification(
  notification: StoredNotification,
): Promise<{ created: boolean }> {
  return mutate((db) => {
    const rows = (db.notifications ??= []);
    if (rows.some((n) => n.id === notification.id)) return { created: false };
    rows.push(notification);
    return { created: true };
  });
}

async function listNotificationsForAccount(
  accountId: string,
): Promise<readonly StoredNotification[]> {
  const db = await readDatabase();
  return (db.notifications ?? [])
    .filter((n) => n.recipientAccountId === accountId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function markNotificationRead(id: string): Promise<boolean> {
  return mutate((db) => {
    const rows = (db.notifications ??= []);
    const index = rows.findIndex((n) => n.id === id);
    if (index < 0 || rows[index]!.readAt !== undefined) return false;
    rows[index] = { ...rows[index]!, readAt: new Date().toISOString() };
    return true;
  });
}


/* --------------------------------------------------------------- billing */

async function getSubscription(accountId: string): Promise<Subscription | undefined> {
  const db = await readDatabase();
  return db.subscriptions.find((s) => s.accountId === accountId);
}

async function listSubscriptions(): Promise<readonly Subscription[]> {
  return (await readDatabase()).subscriptions;
}

async function saveSubscription(subscription: Subscription): Promise<Subscription> {
  return mutate((db) => {
    const index = db.subscriptions.findIndex((s) => s.accountId === subscription.accountId);
    if (index >= 0) db.subscriptions[index] = subscription;
    else db.subscriptions.push(subscription);
    return subscription;
  });
}

async function claimBillingEvent(eventId: string, type: string, at: string): Promise<boolean> {
  // Check and claim inside the write lock. Checking first and claiming after
  // would let two concurrent deliveries of the same event both find it unclaimed.
  return mutate((db) => {
    if (db.billingEvents.some((e) => e.eventId === eventId)) return false;
    db.billingEvents.push({ eventId, type, at });
    return true;
  });
}

async function listCreditLots(accountId: string): Promise<readonly CreditLot[]> {
  const db = await readDatabase();
  return db.creditLots.filter((lot) => lot.accountId === accountId);
}

async function listLedgerEntries(accountId: string): Promise<readonly LedgerEntry[]> {
  const db = await readDatabase();
  return db.ledgerEntries
    .filter((entry) => entry.accountId === accountId)
    .sort((a, b) => a.at.localeCompare(b.at));
}

function balanceOf(db: Database, accountId: string, now: Date): Money {
  return availableBalance(
    db.creditLots.filter((lot) => lot.accountId === accountId),
    now,
  );
}

async function applyTopUp(input: TopUpInput): Promise<TopUpResult> {
  return mutate((db) => {
    const seen = db.ledgerEntries.some((e) => e.idempotencyKey === input.idempotencyKey);
    if (seen) {
      return {
        applied: false,
        duplicate: true,
        balance: balanceOf(db, input.accountId, new Date(input.at)),
        reason: "This top-up has already been applied.",
      };
    }

    db.creditLots.push({
      id: input.purchased.lotId,
      accountId: input.accountId,
      kind: "purchased",
      original: input.purchased.amount,
      remaining: input.purchased.amount,
      cashGross: input.purchased.cashGross,
      cashTax: input.purchased.cashTax,
      createdAt: input.at,
      expiresAt: input.purchased.expiresAt,
      paymentReference: input.paymentReference,
    });
    db.ledgerEntries.push({
      id: `${input.entryIdPrefix}-purchased`,
      at: input.at,
      accountId: input.accountId,
      kind: "topup",
      amount: input.purchased.amount,
      lotId: input.purchased.lotId,
      reference: input.paymentReference,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
    });

    if (input.granted !== undefined) {
      db.creditLots.push({
        id: input.granted.lotId,
        accountId: input.accountId,
        kind: "granted",
        original: input.granted.amount,
        remaining: input.granted.amount,
        cashGross: ZERO,
        cashTax: ZERO,
        createdAt: input.at,
        expiresAt: input.granted.expiresAt,
        paymentReference: input.paymentReference,
      });
      db.ledgerEntries.push({
        id: `${input.entryIdPrefix}-granted`,
        at: input.at,
        accountId: input.accountId,
        kind: "topup",
        amount: input.granted.amount,
        lotId: input.granted.lotId,
        reference: input.paymentReference,
        // A distinct key: the grant is its own movement, and sharing the key
        // would make the unique constraint reject it as a duplicate.
        idempotencyKey: `${input.idempotencyKey}:granted`,
        reason: `${input.reason} (bonus, not refundable in cash)`,
      });
    }

    return {
      applied: true,
      duplicate: false,
      balance: balanceOf(db, input.accountId, new Date(input.at)),
      reason: "Applied.",
    };
  });
}

async function spendCredits(input: SpendInput): Promise<SpendResult> {
  return mutate((db) => {
    const now = new Date(input.at);
    const existing = db.ledgerEntries.find((e) => e.idempotencyKey === input.idempotencyKey);
    if (existing !== undefined) {
      // The same operation retried. Charging again would bill twice for one
      // piece of work.
      return {
        ok: true,
        duplicate: true,
        shortfall: ZERO,
        balance: balanceOf(db, input.accountId, now),
        reason: "Already charged for this operation.",
      };
    }

    const lots = db.creditLots.filter((lot) => lot.accountId === input.accountId);
    const plan = planSpend(lots, input.amount, now);
    if (!plan.ok) {
      return {
        ok: false,
        duplicate: false,
        shortfall: plan.shortfall,
        balance: balanceOf(db, input.accountId, now),
        reason: plan.reason,
      };
    }

    plan.allocations.forEach((allocation, index) => {
      const lotIndex = db.creditLots.findIndex((lot) => lot.id === allocation.lotId);
      const lot = db.creditLots[lotIndex];
      if (lot === undefined) return;
      db.creditLots[lotIndex] = { ...lot, remaining: sub(lot.remaining, allocation.amount) };
      db.ledgerEntries.push({
        id: `${input.entryIdPrefix}-${index}`,
        at: input.at,
        accountId: input.accountId,
        kind: "spend",
        amount: money(-allocation.amount),
        lotId: allocation.lotId,
        reference: input.reference,
        // Only the first entry carries the caller's key; the rest are derived,
        // so a retry still collides on the first and stops there.
        idempotencyKey: index === 0 ? input.idempotencyKey : `${input.idempotencyKey}:${index}`,
        reason: input.reason,
      });
    });

    return {
      ok: true,
      duplicate: false,
      shortfall: ZERO,
      balance: balanceOf(db, input.accountId, now),
      reason: plan.reason,
    };
  });
}

async function reverseLotsForPayment(input: ReversalInput): Promise<ReversalResult> {
  return mutate((db) => {
    let lotsReversed = 0;
    let balanceRemoved = ZERO;
    let debt = ZERO;

    // One share for the whole payment, decided before any lot is touched.
    const ofPayment = db.creditLots.filter(
      (lot) => lot.paymentReference === input.paymentReference && lot.voidedAt === undefined,
    );
    const share = reversalShare(ofPayment, input.refundedGross);

    db.creditLots.forEach((lot, index) => {
      if (lot.paymentReference !== input.paymentReference || lot.voidedAt !== undefined) return;
      const impact = reversalImpact(lot, share);
      if (impact.balanceRemoved <= 0 && impact.debt <= 0 && !impact.voids) return;

      db.creditLots[index] = {
        ...lot,
        remaining: sub(lot.remaining, impact.balanceRemoved),
        ...(impact.voids ? { voidedAt: input.at, voidedReason: input.kind } : {}),
      };

      db.ledgerEntries.push({
        id: `${input.entryIdPrefix}-${lotsReversed}`,
        at: input.at,
        accountId: lot.accountId,
        kind: input.kind,
        amount: money(-impact.balanceRemoved),
        lotId: lot.id,
        reference: input.paymentReference,
        idempotencyKey: `${input.kind}:${input.paymentReference}:${lot.id}`,
        reason: `Payment ${input.paymentReference} reversed. ${impact.reason}`,
      });

      if (impact.debt > 0) {
        db.ledgerEntries.push({
          id: `${input.entryIdPrefix}-${lotsReversed}-debt`,
          at: input.at,
          accountId: lot.accountId,
          kind: "debt",
          amount: money(-impact.debt),
          lotId: lot.id,
          reference: input.paymentReference,
          idempotencyKey: `debt:${input.paymentReference}:${lot.id}`,
          reason: "Balance was spent before the payment was reversed.",
        });
        debt = add(debt, impact.debt);
      }

      balanceRemoved = add(balanceRemoved, impact.balanceRemoved);
      lotsReversed += 1;
    });

    return { lotsReversed, balanceRemoved, debt };
  });
}

async function listDiscoveryCandidates(): Promise<readonly StoredCandidate[]> {
  const db = await readDatabase();
  return [...db.discoveryCandidates].sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));
}

async function saveDiscoveryCandidate(entry: StoredCandidate): Promise<StoredCandidate> {
  return mutate((db) => {
    const index = db.discoveryCandidates.findIndex((c) => c.candidate.id === entry.candidate.id);
    if (index < 0) {
      db.discoveryCandidates.push(entry);
      return entry;
    }
    const existing = db.discoveryCandidates[index];
    // A rerun must not un-suppress somebody or quietly withdraw an approval a
    // person gave. Both are sticky in the direction that protects the recipient.
    const merged: StoredCandidate = {
      ...entry,
      candidate: {
        ...entry.candidate,
        optedOut: entry.candidate.optedOut || (existing?.candidate.optedOut ?? false),
        doNotContact: entry.candidate.doNotContact || (existing?.candidate.doNotContact ?? false),
      },
      ...(existing?.approvedAt !== undefined
        ? { approvedAt: existing.approvedAt, approvedBy: existing.approvedBy }
        : {}),
    };
    db.discoveryCandidates[index] = merged;
    return merged;
  });
}

async function listSourcedProperties(): Promise<readonly StoredSourcedProperty[]> {
  const db = await readDatabase();
  return [...(db.sourcedProperties ?? [])].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

async function saveSourcedProperty(entry: StoredSourcedProperty): Promise<StoredSourcedProperty> {
  return mutate((db) => {
    const list = db.sourcedProperties ?? (db.sourcedProperties = []);
    const index = list.findIndex((p) => p.id === entry.id);
    if (index < 0) {
      list.push(entry);
      return entry;
    }
    const existing = list[index];
    // A rerun refreshes lastSeenAt but must not reset when it was first found,
    // nor un-dismiss something a person set aside.
    const merged: StoredSourcedProperty = {
      ...entry,
      firstSeenAt: existing?.firstSeenAt ?? entry.firstSeenAt,
      ...(existing?.dismissed !== undefined ? { dismissed: existing.dismissed } : entry.dismissed !== undefined ? { dismissed: entry.dismissed } : {}),
    };
    list[index] = merged;
    return merged;
  });
}

async function listIntakeConversations(): Promise<readonly IntakeConversation[]> {
  const db = await readDatabase();
  return [...(db.intakeConversations ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function getIntakeConversation(id: string): Promise<IntakeConversation | undefined> {
  const db = await readDatabase();
  return (db.intakeConversations ?? []).find((c) => c.id === id);
}

async function saveIntakeConversation(conversation: IntakeConversation): Promise<IntakeConversation> {
  return mutate((db) => {
    const list = db.intakeConversations ?? (db.intakeConversations = []);
    const index = list.findIndex((c) => c.id === conversation.id);
    if (index < 0) list.push(conversation);
    else list[index] = conversation;
    return conversation;
  });
}

async function saveIntakeConversationIfCurrent(
  conversation: IntakeConversation,
  expectedRev: number,
): Promise<IntakeConversation | undefined> {
  // Check-and-write inside the single-writer mutate lock, so the comparison and
  // the save are atomic — a concurrent turn cannot slip between them.
  return mutate((db) => {
    const list = db.intakeConversations ?? (db.intakeConversations = []);
    const index = list.findIndex((c) => c.id === conversation.id);
    const current = index < 0 ? undefined : list[index];
    if ((current?.rev ?? 0) !== expectedRev) return undefined;
    if (index < 0) list.push(conversation);
    else list[index] = conversation;
    return conversation;
  });
}

async function listAgentRuns(subjectId?: string): Promise<readonly AgentRunRecord[]> {
  const db = await readDatabase();
  const all = db.agentRuns ?? [];
  const scoped = subjectId === undefined ? all : all.filter((r) => r.subjectId === subjectId);
  return [...scoped].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

async function getAgentRun(id: string): Promise<AgentRunRecord | undefined> {
  const db = await readDatabase();
  return (db.agentRuns ?? []).find((r) => r.id === id);
}

async function saveAgentRun(run: AgentRunRecord): Promise<AgentRunRecord> {
  return mutate((db) => {
    const list = db.agentRuns ?? (db.agentRuns = []);
    const index = list.findIndex((r) => r.id === run.id);
    if (index < 0) list.push(run);
    else list[index] = run;
    return run;
  });
}

async function listOperatorTasks(): Promise<readonly OperatorTask[]> {
  const db = await readDatabase();
  return [...(db.operatorTasks ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function getOperatorTask(id: string): Promise<OperatorTask | undefined> {
  const db = await readDatabase();
  return (db.operatorTasks ?? []).find((t) => t.id === id);
}

async function saveOperatorTask(task: OperatorTask): Promise<OperatorTask> {
  return mutate((db) => {
    const list = db.operatorTasks ?? (db.operatorTasks = []);
    const index = list.findIndex((t) => t.id === task.id);
    if (index < 0) list.push(task);
    else list[index] = task;
    return task;
  });
}

async function saveDealHuntQuery(query: DealHuntQuery): Promise<DealHuntQuery> {
  return mutate((db) => {
    const list = db.dealHuntQueries ?? (db.dealHuntQueries = []);
    const index = list.findIndex((q) => q.id === query.id);
    if (index < 0) list.push(query);
    else list[index] = query;
    return query;
  });
}

async function getDealHuntQuery(id: string): Promise<DealHuntQuery | undefined> {
  const db = await readDatabase();
  return (db.dealHuntQueries ?? []).find((q) => q.id === id);
}

async function saveDealHuntRun(run: DealHuntRun): Promise<DealHuntRun> {
  return mutate((db) => {
    const list = db.dealHuntRuns ?? (db.dealHuntRuns = []);
    const index = list.findIndex((r) => r.id === run.id);
    if (index < 0) list.push(run);
    else list[index] = run;
    return run;
  });
}

async function getDealHuntRun(id: string): Promise<DealHuntRun | undefined> {
  const db = await readDatabase();
  return (db.dealHuntRuns ?? []).find((r) => r.id === id);
}

async function listDealHuntRuns(investorId: string): Promise<readonly DealHuntRun[]> {
  const db = await readDatabase();
  return [...(db.dealHuntRuns ?? [])]
    .filter((r) => r.investorId === investorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function saveDealHuntResult(result: DealHuntResult): Promise<DealHuntResult> {
  return mutate((db) => {
    const list = db.dealHuntResults ?? (db.dealHuntResults = []);
    const index = list.findIndex((r) => r.id === result.id);
    if (index < 0) list.push(result);
    else list[index] = result;
    return result;
  });
}

async function listDealHuntResults(runId: string): Promise<readonly DealHuntResult[]> {
  const db = await readDatabase();
  return [...(db.dealHuntResults ?? [])]
    .filter((r) => r.runId === runId)
    .sort((a, b) => a.rank - b.rank);
}

async function getDealHuntResult(id: string): Promise<DealHuntResult | undefined> {
  const db = await readDatabase();
  return (db.dealHuntResults ?? []).find((r) => r.id === id);
}

async function saveComparableBundle(bundle: StoredComparableBundle): Promise<StoredComparableBundle> {
  return mutate((db) => {
    const list = db.comparableBundles ?? (db.comparableBundles = []);
    const index = list.findIndex((b) => b.id === bundle.id);
    if (index < 0) list.push(bundle);
    else list[index] = bundle;
    return bundle;
  });
}

async function getComparableBundle(id: string): Promise<StoredComparableBundle | undefined> {
  const db = await readDatabase();
  return (db.comparableBundles ?? []).find((b) => b.id === id);
}

async function savePricePaidSales(sales: readonly PricePaidSale[]): Promise<number> {
  if (sales.length === 0) return 0;
  return mutate((db) => {
    const list = db.pricePaidSales ?? (db.pricePaidSales = []);
    // Index by transaction id so a re-load upserts rather than duplicates.
    const index = new Map(list.map((s, i) => [s.transactionId, i]));
    for (const sale of sales) {
      const at = index.get(sale.transactionId);
      if (at === undefined) {
        index.set(sale.transactionId, list.length);
        list.push(sale);
      } else {
        list[at] = sale;
      }
    }
    return sales.length;
  });
}

async function listPricePaidSales(postcode: string): Promise<readonly PricePaidSale[]> {
  const db = await readDatabase();
  // Normalise both sides so stored spacing never decides a match — the Postgres
  // engine normalises its indexed postcode column for the same reason.
  const norm = (value: string): string => value.toUpperCase().replace(/\s+/g, " ").trim();
  const pc = norm(postcode);
  return (db.pricePaidSales ?? [])
    .filter((s) => norm(s.postcode) === pc)
    .sort((a, b) => b.soldAt.localeCompare(a.soldAt));
}

async function countPricePaidSales(): Promise<number> {
  const db = await readDatabase();
  return (db.pricePaidSales ?? []).length;
}

async function saveEvidenceClaim(claim: EvidenceClaim): Promise<EvidenceClaim> {
  return mutate((db) => {
    const list = db.evidenceClaims ?? (db.evidenceClaims = []);
    const index = list.findIndex((c) => c.id === claim.id);
    if (index < 0) list.push(claim);
    else list[index] = claim;
    return claim;
  });
}

async function listEvidenceClaims(propertyId: string): Promise<readonly EvidenceClaim[]> {
  const db = await readDatabase();
  return [...(db.evidenceClaims ?? [])]
    .filter((c) => c.propertyId === propertyId)
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
}

async function saveDecisionSnapshot(snapshot: DecisionSnapshot): Promise<DecisionSnapshot> {
  return mutate((db) => {
    const list = db.decisionSnapshots ?? (db.decisionSnapshots = []);
    const index = list.findIndex((s) => s.id === snapshot.id);
    if (index < 0) list.push(snapshot);
    else list[index] = snapshot;
    return snapshot;
  });
}

async function getDecisionSnapshot(id: string): Promise<DecisionSnapshot | undefined> {
  const db = await readDatabase();
  return (db.decisionSnapshots ?? []).find((s) => s.id === id);
}

async function listDecisionSnapshots(subjectId: string): Promise<readonly DecisionSnapshot[]> {
  const db = await readDatabase();
  return [...(db.decisionSnapshots ?? [])]
    .filter((s) => s.subjectId === subjectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function saveComparisonRun(run: ComparisonRun): Promise<ComparisonRun> {
  return mutate((db) => {
    const list = db.comparisonRuns ?? (db.comparisonRuns = []);
    const index = list.findIndex((r) => r.id === run.id);
    if (index < 0) list.push(run);
    else list[index] = run;
    return run;
  });
}

async function getComparisonRun(id: string): Promise<ComparisonRun | undefined> {
  const db = await readDatabase();
  return (db.comparisonRuns ?? []).find((r) => r.id === id);
}

async function listComparisonRuns(investorId: string): Promise<readonly ComparisonRun[]> {
  const db = await readDatabase();
  return [...(db.comparisonRuns ?? [])]
    .filter((r) => r.investorId === investorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function saveWatchCursor(watch: WatchCursor): Promise<WatchCursor> {
  return mutate((db) => {
    const list = db.watchCursors ?? (db.watchCursors = []);
    const index = list.findIndex((w) => w.id === watch.id);
    if (index < 0) list.push(watch);
    else list[index] = watch;
    return watch;
  });
}

async function getWatchCursor(id: string): Promise<WatchCursor | undefined> {
  const db = await readDatabase();
  return (db.watchCursors ?? []).find((w) => w.id === id);
}

async function listWatchCursors(ownerId: string): Promise<readonly WatchCursor[]> {
  const db = await readDatabase();
  return [...(db.watchCursors ?? [])]
    .filter((w) => w.ownerId === ownerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function saveLayoutHypothesis(hypothesis: LayoutHypothesis): Promise<LayoutHypothesis> {
  return mutate((db) => {
    const list = db.layoutHypotheses ?? (db.layoutHypotheses = []);
    const index = list.findIndex((h) => h.id === hypothesis.id);
    if (index < 0) list.push(hypothesis);
    else list[index] = hypothesis;
    return hypothesis;
  });
}

async function listLayoutHypotheses(propertyId: string): Promise<readonly LayoutHypothesis[]> {
  const db = await readDatabase();
  return [...(db.layoutHypotheses ?? [])]
    .filter((h) => h.propertyId === propertyId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function saveAuctionLot(lot: StoredAuctionLot): Promise<StoredAuctionLot> {
  return mutate((db) => {
    const list = db.auctionLots ?? (db.auctionLots = []);
    const index = list.findIndex((l) => l.id === lot.id);
    if (index < 0) list.push(lot);
    else list[index] = lot;
    return lot;
  });
}

async function listAuctionLots(propertyId: string): Promise<readonly StoredAuctionLot[]> {
  const db = await readDatabase();
  return [...(db.auctionLots ?? [])]
    .filter((l) => l.propertyId === propertyId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function listContactedLeads(): Promise<readonly ContactedLead[]> {
  const db = await readDatabase();
  return [...(db.contactedLeads ?? [])].sort((a, b) => b.contactedAt.localeCompare(a.contactedAt));
}

async function markContactedLead(entry: ContactedLead): Promise<boolean> {
  return mutate((db) => {
    const list = db.contactedLeads ?? (db.contactedLeads = []);
    if (list.some((c) => c.key === entry.key)) return false;
    list.push(entry);
    return true;
  });
}

async function clearContactedLead(key: string): Promise<boolean> {
  return mutate((db) => {
    const list = db.contactedLeads ?? (db.contactedLeads = []);
    const index = list.findIndex((c) => c.key === key);
    if (index < 0) return false;
    list.splice(index, 1);
    return true;
  });
}

async function listImportedListings(): Promise<readonly StoredImportedListing[]> {
  const db = await readDatabase();
  return [...(db.importedListings ?? [])].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

async function saveImportedListing(entry: StoredImportedListing): Promise<StoredImportedListing> {
  return mutate((db) => {
    const list = db.importedListings ?? (db.importedListings = []);
    const index = list.findIndex((l) => l.id === entry.id);
    if (index < 0) {
      list.push(entry);
      return entry;
    }
    const existing = list[index];
    // A re-import refreshes the facts but keeps when it was first submitted.
    const merged: StoredImportedListing = {
      ...entry,
      submittedAt: existing?.submittedAt ?? entry.submittedAt,
    };
    list[index] = merged;
    return merged;
  });
}

async function listOutreachMessages(): Promise<readonly OutreachMessage[]> {
  const db = await readDatabase();
  return [...db.outreachMessages].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function saveOutreachMessage(message: OutreachMessage): Promise<OutreachMessage> {
  return mutate((db) => {
    const index = db.outreachMessages.findIndex((m) => m.id === message.id);
    if (index >= 0) db.outreachMessages[index] = message;
    else db.outreachMessages.push(message);
    return message;
  });
}

async function listSuppressions(): Promise<readonly Suppression[]> {
  return (await readDatabase()).suppressions;
}

async function addSuppression(entry: Suppression): Promise<boolean> {
  return mutate((db) => {
    const address = entry.email.trim().toLowerCase();
    if (db.suppressions.some((s) => s.email === address)) return false;
    db.suppressions.push({ ...entry, email: address });
    return true;
  });
}

async function listDealFees(dealId: string): Promise<readonly DealFee[]> {
  const db = await readDatabase();
  return db.dealFees
    .filter((f) => f.dealId === dealId)
    .sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
}

async function raiseDealFee(fee: DealFee): Promise<boolean> {
  return mutate((db) => {
    // Read and write in one operation. Two people pressing the button at the
    // same time is exactly how a client gets invoiced twice.
    const live = db.dealFees.some(
      (f) => f.dealId === fee.dealId && f.feeKey === fee.feeKey && f.voidedAt === undefined,
    );
    if (live) return false;
    db.dealFees.push(fee);
    return true;
  });
}

async function listRevealsForAccount(accountId: string): Promise<readonly RevealRecord[]> {
  const db = await readDatabase();
  return db.reveals
    .filter((r) => r.accountId === accountId)
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
}

async function listRevealsForDeal(dealId: string): Promise<readonly RevealRecord[]> {
  const db = await readDatabase();
  return db.reveals
    .filter((r) => r.dealId === dealId)
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
}

async function recordReveal(record: RevealRecord): Promise<boolean> {
  return mutate((db) => {
    // The key is the check. A retried payment confirmation must not charge a
    // buyer twice for the same introduction.
    if (db.reveals.some((r) => r.idempotencyKey === record.idempotencyKey)) return false;
    db.reveals.push(record);
    return true;
  });
}

async function refundReveal(
  id: string,
  at: string,
  trigger: RefundTrigger,
  reason: string,
): Promise<boolean> {
  return mutate((db) => {
    const index = db.reveals.findIndex((r) => r.id === id && r.refundedAt === undefined);
    const current = db.reveals[index];
    if (index < 0 || current === undefined) return false;
    db.reveals[index] = { ...current, refundedAt: at, refundTrigger: trigger, refundReason: reason };
    return true;
  });
}

async function listPayoutRecipients(): Promise<readonly PayoutRecipient[]> {
  return (await readDatabase()).payoutRecipients;
}

async function getPayoutRecipient(id: string): Promise<PayoutRecipient | undefined> {
  return (await readDatabase()).payoutRecipients.find((r) => r.id === id);
}

async function savePayoutRecipient(recipient: PayoutRecipient): Promise<PayoutRecipient> {
  await mutate((db) => {
    const index = db.payoutRecipients.findIndex((r) => r.id === recipient.id);
    if (index < 0) db.payoutRecipients.push(recipient);
    else db.payoutRecipients[index] = recipient;
    return true;
  });
  return recipient;
}

async function listPayouts(): Promise<readonly PayoutRecord[]> {
  const db = await readDatabase();
  return [...db.payouts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function recordPayout(payout: PayoutRecord): Promise<boolean> {
  return mutate((db) => {
    // The key is the check. Money going out is more dangerous than money
    // coming in: a duplicate payment in is refundable and a duplicate payment
    // out is gone.
    if (db.payouts.some((p) => p.idempotencyKey === payout.idempotencyKey)) return false;
    db.payouts.push(payout);
    return true;
  });
}

async function closePayout(
  id: string,
  outcome:
    | { readonly settledAt: string; readonly transferReference: string }
    | { readonly failedAt: string; readonly failureReason: string },
): Promise<boolean> {
  return mutate((db) => {
    const index = db.payouts.findIndex(
      (p) => p.id === id && p.settledAt === undefined && p.failedAt === undefined,
    );
    const current = db.payouts[index];
    if (index < 0 || current === undefined) return false;
    db.payouts[index] = { ...current, ...outcome };
    return true;
  });
}

async function voidDealFee(id: string, at: string, by: string, reason: string): Promise<boolean> {
  return mutate((db) => {
    const index = db.dealFees.findIndex((f) => f.id === id && f.voidedAt === undefined);
    const current = db.dealFees[index];
    if (index < 0 || current === undefined) return false;
    // Voided, never removed. An invoice that was sent happened.
    db.dealFees[index] = { ...current, voidedAt: at, voidedBy: by, voidReason: reason };
    return true;
  });
}

async function listAgentDecisions(dealId: string): Promise<readonly AgentDecision[]> {
  const db = await readDatabase();
  return db.agentDecisions
    .filter((d) => d.dealId === dealId)
    .sort((a, b) => b.at.localeCompare(a.at));
}

async function saveAgentDecision(decision: AgentDecision): Promise<AgentDecision> {
  return mutate((db) => {
    // Keyed by id, and ids are minted per decision, so a change of mind appends
    // rather than overwriting. The board reads the most recent; the trail keeps
    // the rest.
    const index = db.agentDecisions.findIndex((d) => d.id === decision.id);
    if (index >= 0) db.agentDecisions[index] = decision;
    else db.agentDecisions.push(decision);
    return decision;
  });
}

async function listDataRoomGrants(): Promise<readonly DataRoomGrant[]> {
  const db = await readDatabase();
  return [...db.dataRoomGrants].sort((a, b) => b.grantedAt.localeCompare(a.grantedAt));
}

async function getDataRoomGrant(token: string): Promise<DataRoomGrant | undefined> {
  const db = await readDatabase();
  return db.dataRoomGrants.find((g) => g.token === token);
}

async function saveDataRoomGrant(grant: DataRoomGrant): Promise<DataRoomGrant> {
  return mutate((db) => {
    const index = db.dataRoomGrants.findIndex((g) => g.token === grant.token);
    if (index >= 0) db.dataRoomGrants[index] = grant;
    else db.dataRoomGrants.push(grant);
    return grant;
  });
}

async function getPendingCharge(id: string): Promise<PendingCharge | undefined> {
  const db = await readDatabase();
  return db.pendingCharges.find((c) => c.id === id);
}

async function savePendingCharge(charge: PendingCharge): Promise<PendingCharge> {
  return mutate((db) => {
    const index = db.pendingCharges.findIndex((c) => c.id === charge.id);
    if (index >= 0) db.pendingCharges[index] = charge;
    else db.pendingCharges.push(charge);
    return charge;
  });
}

async function recordAllowanceUse(input: AllowanceInput): Promise<AllowanceResult> {
  return mutate((db) => {
    const mine = db.ledgerEntries.filter((e) => e.accountId === input.accountId);
    if (mine.some((e) => e.idempotencyKey === input.idempotencyKey)) {
      const used = mine.filter((e) => e.kind === "allowance" && e.at >= input.periodStart).length;
      return {
        allowed: true,
        duplicate: true,
        used,
        limit: input.limit,
        reason: "Already counted in this period.",
      };
    }

    const used = mine.filter((e) => e.kind === "allowance" && e.at >= input.periodStart).length;
    if (used >= input.limit) {
      return {
        allowed: false,
        duplicate: false,
        used,
        limit: input.limit,
        reason:
          input.limit === 0
            ? "This plan does not include any."
            : `All ${input.limit} included this period have been used.`,
      };
    }

    db.ledgerEntries.push({
      id: input.entryId,
      at: input.at,
      accountId: input.accountId,
      kind: "allowance",
      amount: ZERO,
      reference: input.reference,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
    });

    return {
      allowed: true,
      duplicate: false,
      used: used + 1,
      limit: input.limit,
      reason: `${used + 1} of ${input.limit} used this period.`,
    };
  });
}

async function recordNote(input: NoteInput): Promise<boolean> {
  return mutate((db) => {
    if (db.ledgerEntries.some((e) => e.idempotencyKey === input.idempotencyKey)) return false;
    db.ledgerEntries.push({
      id: input.entryId,
      at: input.at,
      accountId: input.accountId,
      kind: input.kind,
      amount: input.amount,
      ...(input.reference !== undefined ? { reference: input.reference } : {}),
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
    });
    return true;
  });
}

async function expireLapsedCredits(now: string, entryIdPrefix: string): Promise<number> {
  return mutate((db) => {
    const due = dueForExpiry(db.creditLots, new Date(now));
    due.forEach((expiry, index) => {
      const lotIndex = db.creditLots.findIndex((lot) => lot.id === expiry.lotId);
      const lot = db.creditLots[lotIndex];
      if (lot === undefined) return;
      db.creditLots[lotIndex] = { ...lot, remaining: ZERO };
      db.ledgerEntries.push({
        id: `${entryIdPrefix}-${index}`,
        at: now,
        accountId: lot.accountId,
        kind: "expire",
        amount: money(-expiry.amount),
        lotId: lot.id,
        idempotencyKey: `expire:${lot.id}`,
        reason: `Balance lapsed on ${expiry.expiredAt.slice(0, 10)}.`,
      });
    });
    return due.length;
  });
}

/**
 * Increment inside the write lock.
 *
 * `mutate` serialises through the write chain, so the read and the increment
 * are one operation and two concurrent views cannot both read 5 and both
 * write 6.
 */
async function recordBlogView(slug: string, at: string): Promise<BlogViewCount> {
  return mutate((db) => {
    const index = db.blogViews.findIndex((v) => v.slug === slug);
    const current = index >= 0 ? db.blogViews[index] : undefined;
    const next: BlogViewCount = {
      slug,
      views: (current?.views ?? 0) + 1,
      lastViewedAt: at,
    };
    if (index >= 0) db.blogViews[index] = next;
    else db.blogViews.push(next);
    return next;
  });
}

async function listBlogViews(): Promise<readonly BlogViewCount[]> {
  const db = await readDatabase();
  return [...db.blogViews].sort((a, b) => b.views - a.views);
}

/** Append only. There is deliberately no update or delete for audit events. */
async function appendAudit(event: AuditEvent): Promise<AuditEvent> {
  return mutate((db) => {
    db.auditEvents.push(event);
    return event;
  });
}

async function listAudit(
  { limit = 200, subject }: { limit?: number; subject?: string } = {},
): Promise<readonly AuditEvent[]> {
  const db = await readDatabase();
  return db.auditEvents
    .filter((e) => subject === undefined || e.subject === subject)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

/** The file-backed implementation. */
export const fileStore: Store = {
  kind: "file",
  listDeals,
  listDealsForOwner,
  pageDeals,
  getDeal,
  saveDeal,
  deleteDeal,
  listBuyBoxes,
  saveBuyBox,
  getBuyBox,
  deleteBuyBox,
  listFundingBoxes,
  saveFundingBox,
  getFundingBox,
  deleteFundingBox,
  replaceAll,
  listSubscribers,
  findSubscriberByEmail,
  saveSubscriber,
  updateSubscriberByToken,
  markIssueSent,
  listAccounts,
  getAccount,
  findAccountByEmail,
  saveAccount,
  getAccountImage,
  saveAccountImage,
  deleteAccountImage,
  getDealImage,
  listDealImages,
  saveDealImage,
  deleteDealImage,
  recordNotification,
  listNotificationsForAccount,
  markNotificationRead,
  recordBlogView,
  listBlogViews,
  getSubscription,
  listSubscriptions,
  saveSubscription,
  claimBillingEvent,
  listCreditLots,
  listLedgerEntries,
  applyTopUp,
  spendCredits,
  reverseLotsForPayment,
  listDiscoveryCandidates,
  saveDiscoveryCandidate,
  listSourcedProperties,
  saveSourcedProperty,
  listIntakeConversations,
  getIntakeConversation,
  saveIntakeConversation,
  saveIntakeConversationIfCurrent,
  listAgentRuns,
  getAgentRun,
  saveAgentRun,
  listOperatorTasks,
  getOperatorTask,
  saveOperatorTask,
  saveDealHuntQuery,
  getDealHuntQuery,
  saveDealHuntRun,
  getDealHuntRun,
  listDealHuntRuns,
  saveDealHuntResult,
  listDealHuntResults,
  getDealHuntResult,
  saveComparableBundle,
  getComparableBundle,
  savePricePaidSales,
  listPricePaidSales,
  countPricePaidSales,
  saveEvidenceClaim,
  listEvidenceClaims,
  saveDecisionSnapshot,
  getDecisionSnapshot,
  listDecisionSnapshots,
  saveComparisonRun,
  getComparisonRun,
  listComparisonRuns,
  saveWatchCursor,
  getWatchCursor,
  listWatchCursors,
  saveLayoutHypothesis,
  listLayoutHypotheses,
  saveAuctionLot,
  listAuctionLots,
  listContactedLeads,
  markContactedLead,
  clearContactedLead,
  listImportedListings,
  saveImportedListing,
  listOutreachMessages,
  saveOutreachMessage,
  listSuppressions,
  addSuppression,
  listDealFees,
  raiseDealFee,
  listRevealsForAccount,
  listRevealsForDeal,
  recordReveal,
  refundReveal,
  listPayoutRecipients,
  getPayoutRecipient,
  savePayoutRecipient,
  listPayouts,
  recordPayout,
  closePayout,
  voidDealFee,
  listAgentDecisions,
  saveAgentDecision,
  listDataRoomGrants,
  getDataRoomGrant,
  saveDataRoomGrant,
  getPendingCharge,
  savePendingCharge,
  recordAllowanceUse,
  recordNote,
  expireLapsedCredits,
  appendAudit,
  listAudit,
  isEmpty,
};

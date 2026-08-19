import { promises as fs } from "node:fs";
import path from "node:path";
import type { BuyBox, FundingBox } from "@/domain/matching";
import type { DealInputs, PropertyFacts, SellerProfile } from "@/domain/types";
import type { ListingSignal } from "@/domain/goldmine";
import type { Milestone } from "@/domain/completion";
import type { Subscriber } from "@/domain/newsletter";

/**
 * File-backed repository.
 *
 * Deliberately a narrow interface over JSON on disk. Nothing in the domain
 * layer imports this module, and this module imports no domain logic beyond
 * types, so replacing it with Postgres is a change to one file.
 *
 * Concurrency: writes are serialised through a promise chain and go via a
 * temporary file plus rename, so a crash mid-write cannot leave a truncated
 * store behind. This is adequate for a single-process development server and
 * is not a substitute for a real database under load.
 */

export interface DealRecord {
  readonly id: string;
  readonly reference: string;
  readonly createdAt: string;
  readonly property: PropertyFacts;
  readonly seller: SellerProfile;
  readonly inputs: DealInputs;
  readonly listing?: ListingSignal;
  readonly milestones?: readonly Milestone[];
  readonly borrowerCompletedDeals: number;
  readonly status: "new" | "qualified" | "in-market" | "funded" | "completed" | "withdrawn";
}

export interface Database {
  deals: DealRecord[];
  buyBoxes: BuyBox[];
  fundingBoxes: FundingBox[];
  subscribers: Subscriber[];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "lode.json");

const EMPTY: Database = { deals: [], buyBoxes: [], fundingBoxes: [], subscribers: [] };

let writeChain: Promise<unknown> = Promise.resolve();

async function readDatabase(): Promise<Database> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<Database>;
    return {
      deals: parsed.deals ?? [],
      buyBoxes: parsed.buyBoxes ?? [],
      fundingBoxes: parsed.fundingBoxes ?? [],
      subscribers: parsed.subscribers ?? [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...EMPTY };
    }
    throw error;
  }
}

async function writeDatabase(db: Database): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(temp, DATA_FILE);
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

export async function listDeals(): Promise<readonly DealRecord[]> {
  const db = await readDatabase();
  return db.deals;
}

export async function getDeal(id: string): Promise<DealRecord | undefined> {
  const db = await readDatabase();
  return db.deals.find((d) => d.id === id);
}

export async function saveDeal(deal: DealRecord): Promise<DealRecord> {
  return mutate((db) => {
    const index = db.deals.findIndex((d) => d.id === deal.id);
    if (index >= 0) db.deals[index] = deal;
    else db.deals.push(deal);
    return deal;
  });
}

export async function listBuyBoxes(): Promise<readonly BuyBox[]> {
  const db = await readDatabase();
  return db.buyBoxes;
}

export async function saveBuyBox(box: BuyBox): Promise<BuyBox> {
  return mutate((db) => {
    const index = db.buyBoxes.findIndex((b) => b.id === box.id);
    if (index >= 0) db.buyBoxes[index] = box;
    else db.buyBoxes.push(box);
    return box;
  });
}

export async function getBuyBox(id: string): Promise<BuyBox | undefined> {
  const db = await readDatabase();
  return db.buyBoxes.find((b) => b.id === id);
}

/** Returns true where a box existed and was removed. */
export async function deleteBuyBox(id: string): Promise<boolean> {
  return mutate((db) => {
    const index = db.buyBoxes.findIndex((b) => b.id === id);
    if (index < 0) return false;
    db.buyBoxes.splice(index, 1);
    return true;
  });
}

export async function listFundingBoxes(): Promise<readonly FundingBox[]> {
  const db = await readDatabase();
  return db.fundingBoxes;
}

export async function saveFundingBox(box: FundingBox): Promise<FundingBox> {
  return mutate((db) => {
    const index = db.fundingBoxes.findIndex((b) => b.id === box.id);
    if (index >= 0) db.fundingBoxes[index] = box;
    else db.fundingBoxes.push(box);
    return box;
  });
}

export async function getFundingBox(id: string): Promise<FundingBox | undefined> {
  const db = await readDatabase();
  return db.fundingBoxes.find((b) => b.id === id);
}

/** Returns true where a box existed and was removed. */
export async function deleteFundingBox(id: string): Promise<boolean> {
  return mutate((db) => {
    const index = db.fundingBoxes.findIndex((b) => b.id === id);
    if (index < 0) return false;
    db.fundingBoxes.splice(index, 1);
    return true;
  });
}

export async function replaceAll(db: Database): Promise<void> {
  await mutate((current) => {
    current.deals = db.deals;
    current.buyBoxes = db.buyBoxes;
    current.fundingBoxes = db.fundingBoxes;
    // Subscribers are consent records and survive a reseed. Wiping them would
    // destroy the evidence of consent and silently re-enrol nobody, leaving
    // the platform unable to prove why an address was mailed.
    if (db.subscribers.length > 0) current.subscribers = db.subscribers;
  });
}

// --- Subscribers -----------------------------------------------------------

export async function listSubscribers(): Promise<readonly Subscriber[]> {
  const db = await readDatabase();
  return db.subscribers;
}

export async function findSubscriberByEmail(email: string): Promise<Subscriber | undefined> {
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
export async function saveSubscriber(subscriber: Subscriber): Promise<Subscriber> {
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
export async function updateSubscriberByToken(
  field: "confirmToken" | "unsubscribeToken",
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
export async function markIssueSent(ids: readonly string[], weekKey: string): Promise<number> {
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
export async function isEmpty(): Promise<boolean> {
  const db = await readDatabase();
  return db.deals.length === 0 && db.buyBoxes.length === 0 && db.fundingBoxes.length === 0;
}

import { promises as fs } from "node:fs";
import path from "node:path";
import type { BuyBox, FundingBox } from "@/domain/matching";
import type { Subscriber } from "@/domain/newsletter";
import type { Database, DealRecord, Store, SubscriberTokenField } from "@/store/schema";

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
  return { deals: [], buyBoxes: [], fundingBoxes: [], subscribers: [] };
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

/** The file-backed implementation. */
export const fileStore: Store = {
  kind: "file",
  listDeals,
  getDeal,
  saveDeal,
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
  isEmpty,
};

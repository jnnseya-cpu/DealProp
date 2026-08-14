import { promises as fs } from "node:fs";
import path from "node:path";
import type { BuyBox, FundingBox } from "@/domain/matching";
import type { DealInputs, PropertyFacts, SellerProfile } from "@/domain/types";
import type { ListingSignal } from "@/domain/goldmine";
import type { Milestone } from "@/domain/completion";

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
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "lode.json");

const EMPTY: Database = { deals: [], buyBoxes: [], fundingBoxes: [] };

let writeChain: Promise<unknown> = Promise.resolve();

async function readDatabase(): Promise<Database> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<Database>;
    return {
      deals: parsed.deals ?? [],
      buyBoxes: parsed.buyBoxes ?? [],
      fundingBoxes: parsed.fundingBoxes ?? [],
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

export async function replaceAll(db: Database): Promise<void> {
  await mutate((current) => {
    current.deals = db.deals;
    current.buyBoxes = db.buyBoxes;
    current.fundingBoxes = db.fundingBoxes;
  });
}

/** True when the store has never been seeded. */
export async function isEmpty(): Promise<boolean> {
  const db = await readDatabase();
  return db.deals.length === 0 && db.buyBoxes.length === 0 && db.fundingBoxes.length === 0;
}

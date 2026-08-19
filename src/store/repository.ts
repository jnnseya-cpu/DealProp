import type { BuyBox, FundingBox } from "@/domain/matching";
import type { Subscriber } from "@/domain/newsletter";
import { fileStore } from "@/store/fileStore";
import type { Database, DealRecord, Store, SubscriberTokenField } from "@/store/schema";

export type { Database, DealRecord } from "@/store/schema";

/**
 * The repository.
 *
 * One narrow interface over persistence, and the only module the rest of the
 * app imports. Nothing in `src/domain` imports it, and it imports no domain
 * logic beyond types, which is what lets the storage engine change without any
 * engine code changing with it.
 *
 * Which engine runs is decided by `DATABASE_URL` alone:
 *
 *  - set   → Postgres. Real concurrency, durability, reachable from more than
 *            one process. Required on any host that runs more than one
 *            instance, which includes every serverless deployment.
 *  - unset → the JSON file. Zero configuration, correct for a single-process
 *            development server, and wrong anywhere else — instances do not
 *            share a filesystem, so writes silently diverge.
 *
 * The Postgres module is imported lazily so a development machine with no
 * database never loads the driver.
 */

let selected: Store | undefined;

async function store(): Promise<Store> {
  if (selected !== undefined) return selected;
  const url = process.env.DATABASE_URL;
  if (url !== undefined && url !== "") {
    const { postgresStore } = await import("@/store/postgresStore");
    selected = postgresStore;
  } else {
    selected = fileStore;
  }
  return selected;
}

/** Which engine is serving this process. Reported by scripts, never inferred. */
export async function storeKind(): Promise<Store["kind"]> {
  return (await store()).kind;
}

export async function listDeals(): Promise<readonly DealRecord[]> {
  return (await store()).listDeals();
}

export async function getDeal(id: string): Promise<DealRecord | undefined> {
  return (await store()).getDeal(id);
}

export async function saveDeal(deal: DealRecord): Promise<DealRecord> {
  return (await store()).saveDeal(deal);
}

export async function listBuyBoxes(): Promise<readonly BuyBox[]> {
  return (await store()).listBuyBoxes();
}

export async function getBuyBox(id: string): Promise<BuyBox | undefined> {
  return (await store()).getBuyBox(id);
}

export async function saveBuyBox(box: BuyBox): Promise<BuyBox> {
  return (await store()).saveBuyBox(box);
}

/** Returns true where a box existed and was removed. */
export async function deleteBuyBox(id: string): Promise<boolean> {
  return (await store()).deleteBuyBox(id);
}

export async function listFundingBoxes(): Promise<readonly FundingBox[]> {
  return (await store()).listFundingBoxes();
}

export async function getFundingBox(id: string): Promise<FundingBox | undefined> {
  return (await store()).getFundingBox(id);
}

export async function saveFundingBox(box: FundingBox): Promise<FundingBox> {
  return (await store()).saveFundingBox(box);
}

/** Returns true where a box existed and was removed. */
export async function deleteFundingBox(id: string): Promise<boolean> {
  return (await store()).deleteFundingBox(id);
}

export async function replaceAll(db: Database): Promise<void> {
  return (await store()).replaceAll(db);
}

// --- Subscribers -----------------------------------------------------------

export async function listSubscribers(): Promise<readonly Subscriber[]> {
  return (await store()).listSubscribers();
}

export async function findSubscriberByEmail(email: string): Promise<Subscriber | undefined> {
  return (await store()).findSubscriberByEmail(email);
}

/**
 * Upsert by email.
 *
 * Email is the natural key: a second signup for an address that already exists
 * must update that record rather than create a duplicate, or one person ends up
 * receiving the newsletter twice and unsubscribing only half of themselves.
 */
export async function saveSubscriber(subscriber: Subscriber): Promise<Subscriber> {
  return (await store()).saveSubscriber(subscriber);
}

/**
 * Apply a change to a subscriber found by token, atomically.
 *
 * Confirmation and unsubscribe both arrive as URLs that may be clicked twice
 * (mail clients prefetch links). The lookup and the write are one operation so
 * the second click cannot race the first.
 */
export async function updateSubscriberByToken(
  field: SubscriberTokenField,
  token: string,
  change: (current: Subscriber) => Subscriber,
): Promise<Subscriber | undefined> {
  return (await store()).updateSubscriberByToken(field, token, change);
}

/** Record that an issue was sent, so a re-run cannot send it twice. */
export async function markIssueSent(ids: readonly string[], weekKey: string): Promise<number> {
  return (await store()).markIssueSent(ids, weekKey);
}

/** True when the store has never been seeded. */
export async function isEmpty(): Promise<boolean> {
  return (await store()).isEmpty();
}

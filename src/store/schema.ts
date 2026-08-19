import type { BuyBox, FundingBox } from "@/domain/matching";
import type { DealInputs, PropertyFacts, SellerProfile } from "@/domain/types";
import type { ListingSignal } from "@/domain/goldmine";
import type { Milestone } from "@/domain/completion";
import type { Subscriber } from "@/domain/newsletter";

/**
 * What the store holds and what it can be asked to do.
 *
 * Separated from `repository.ts` so the two implementations — a JSON file and
 * Postgres — can both depend on this without either depending on the other, and
 * so the interface is a thing that exists rather than a shape implied by
 * whichever file happens to be imported.
 *
 * Nothing here carries domain logic. The store puts records in and takes them
 * out; every decision about what a record means lives in `src/domain`.
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

export type SubscriberTokenField = "confirmToken" | "unsubscribeToken";

export interface Store {
  readonly kind: "file" | "postgres";

  listDeals(): Promise<readonly DealRecord[]>;
  getDeal(id: string): Promise<DealRecord | undefined>;
  saveDeal(deal: DealRecord): Promise<DealRecord>;

  listBuyBoxes(): Promise<readonly BuyBox[]>;
  getBuyBox(id: string): Promise<BuyBox | undefined>;
  saveBuyBox(box: BuyBox): Promise<BuyBox>;
  deleteBuyBox(id: string): Promise<boolean>;

  listFundingBoxes(): Promise<readonly FundingBox[]>;
  getFundingBox(id: string): Promise<FundingBox | undefined>;
  saveFundingBox(box: FundingBox): Promise<FundingBox>;
  deleteFundingBox(id: string): Promise<boolean>;

  listSubscribers(): Promise<readonly Subscriber[]>;
  findSubscriberByEmail(email: string): Promise<Subscriber | undefined>;
  saveSubscriber(subscriber: Subscriber): Promise<Subscriber>;
  /**
   * Look up by token and write the result of `change`, atomically.
   *
   * Confirmation and unsubscribe both arrive as URLs that can be clicked twice
   * — mail clients prefetch links — so the read and the write have to be one
   * operation or the second click races the first.
   */
  updateSubscriberByToken(
    field: SubscriberTokenField,
    token: string,
    change: (current: Subscriber) => Subscriber,
  ): Promise<Subscriber | undefined>;
  markIssueSent(ids: readonly string[], weekKey: string): Promise<number>;

  replaceAll(db: Database): Promise<void>;
  isEmpty(): Promise<boolean>;
}

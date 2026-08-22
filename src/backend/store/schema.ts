import type { BuyBox, FundingBox } from "@shared/domain/matching";
import type { DealInputs, PropertyFacts, SellerProfile } from "@shared/domain/types";
import type { ListingSignal } from "@shared/domain/goldmine";
import type { Milestone } from "@shared/domain/completion";
import type { Subscriber } from "@shared/domain/newsletter";
import type { Account } from "@shared/domain/accounts";

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
  accounts: Account[];
  auditEvents: AuditEvent[];
}

/**
 * One entry in the audit trail.
 *
 * Append-only by contract: the store exposes `appendAudit` and no update or
 * delete. A log that can be edited answers no question worth asking, and the
 * question this one exists to answer — who looked at this seller's file, and
 * when — is asked after something has already gone wrong.
 */
export interface AuditEvent {
  readonly id: string;
  /** ISO-8601. */
  readonly at: string;
  /** Null for actions taken before sign-in, such as a failed attempt. */
  readonly accountId?: string;
  readonly email?: string;
  readonly action: AuditAction;
  /** What was acted on: a deal id, an account id, a mandate id. */
  readonly subject?: string;
  readonly detail?: string;
}

export type AuditAction =
  | "sign-in"
  | "sign-in-failed"
  | "sign-out"
  | "account-created"
  | "account-disabled"
  | "account-enabled"
  | "certification-given"
  | "viewed-seller-data"
  | "viewed-deal-material"
  | "mandate-saved"
  | "mandate-deleted"
  | "access-denied";

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

  listAccounts(): Promise<readonly Account[]>;
  getAccount(id: string): Promise<Account | undefined>;
  findAccountByEmail(email: string): Promise<Account | undefined>;
  saveAccount(account: Account): Promise<Account>;

  /** Append only. There is deliberately no update or delete. */
  appendAudit(event: AuditEvent): Promise<AuditEvent>;
  /** Most recent first. `subject` narrows to one deal or account. */
  listAudit(options?: { limit?: number; subject?: string }): Promise<readonly AuditEvent[]>;

  replaceAll(db: Database): Promise<void>;
  isEmpty(): Promise<boolean>;
}

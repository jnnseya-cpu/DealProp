import type { BuyBox, FundingBox } from "@shared/domain/matching";
import type { DealInputs, PropertyFacts, SellerProfile } from "@shared/domain/types";
import type { ListingSignal } from "@shared/domain/goldmine";
import type { Milestone } from "@shared/domain/completion";
import type { Subscriber } from "@shared/domain/newsletter";
import type { Account } from "@shared/domain/accounts";
import type { CreditLot, LedgerEntry } from "@shared/domain/ledger";
import type { Subscription } from "@shared/domain/entitlements";
import type { Money } from "@shared/money";

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

/**
 * How many times a post has been opened.
 *
 * A count and nothing else. No visitor identifier, no IP address, no user
 * agent, no timestamp per view — so there is no personal data here to protect
 * and nothing that could be turned back into a person. That is deliberate: the
 * question worth answering is "which posts are read", and answering it does not
 * require knowing who read them.
 *
 * It is also why this works when the pixels do not. An ad blocker, a declined
 * consent banner or a blocked vendor domain all stop Meta and Google; none of
 * them stop this, because it is a request to our own server that stores no
 * device data and therefore needs no consent under PECR reg. 6.
 */
export interface BlogViewCount {
  readonly slug: string;
  readonly views: number;
  /** ISO-8601, of the most recent view. Not a per-view log. */
  readonly lastViewedAt: string;
}

export interface Database {
  deals: DealRecord[];
  buyBoxes: BuyBox[];
  fundingBoxes: FundingBox[];
  subscribers: Subscriber[];
  accounts: Account[];
  auditEvents: AuditEvent[];
  blogViews: BlogViewCount[];
  subscriptions: Subscription[];
  creditLots: CreditLot[];
  ledgerEntries: LedgerEntry[];
  /** Provider event ids already acted on. The webhook replay defence. */
  billingEvents: ProcessedEvent[];
}

export interface ReversalInput {
  readonly paymentReference: string;
  /** "full" for a dispute; the cash actually returned for a refund. */
  readonly refundedGross: Money | "full";
  readonly kind: "refund" | "chargeback";
  readonly at: string;
  readonly entryIdPrefix: string;
}

export interface ReversalResult {
  readonly lotsReversed: number;
  readonly balanceRemoved: Money;
  /** Service consumed that the reversal has now taken payment for. */
  readonly debt: Money;
}

export interface ProcessedEvent {
  readonly eventId: string;
  readonly at: string;
  readonly type: string;
}

/**
 * A top-up to apply, decided by the caller and written atomically here.
 *
 * The two lots are separate because a bonus is never refundable in cash, and a
 * refund calculation that cannot tell the two apart will eventually pay one out.
 */
export interface TopUpInput {
  readonly accountId: string;
  /** Unique. A repeated key writes nothing and returns what happened the first time. */
  readonly idempotencyKey: string;
  readonly at: string;
  readonly purchased: {
    readonly lotId: string;
    readonly amount: Money;
    readonly cashGross: Money;
    readonly cashTax: Money;
    readonly expiresAt: string;
  };
  readonly granted?: {
    readonly lotId: string;
    readonly amount: Money;
    readonly expiresAt: string;
  };
  readonly paymentReference: string;
  readonly entryIdPrefix: string;
  readonly reason: string;
}

export interface TopUpResult {
  readonly applied: boolean;
  /** True where an identical key had already been applied. */
  readonly duplicate: boolean;
  readonly balance: Money;
  readonly reason: string;
}

export interface SpendInput {
  readonly accountId: string;
  readonly idempotencyKey: string;
  readonly at: string;
  readonly amount: Money;
  readonly entryIdPrefix: string;
  /** What is being paid for, for the ledger line. */
  readonly reference: string;
  readonly reason: string;
}

/**
 * One use of a plan allowance.
 *
 * Counted in the ledger rather than from the audit trail, because the audit
 * write is best-effort by design and a swallowed failure would hand out an
 * uncapped allowance. The key makes a repeat use of the same item in the same
 * period free rather than counting twice.
 */
export interface AllowanceInput {
  readonly accountId: string;
  readonly idempotencyKey: string;
  readonly at: string;
  /** Only uses at or after this count towards the limit. */
  readonly periodStart: string;
  readonly limit: number;
  readonly entryId: string;
  readonly reference: string;
  readonly reason: string;
}

export interface AllowanceResult {
  readonly allowed: boolean;
  /** True where this exact item was already counted in this period. */
  readonly duplicate: boolean;
  readonly used: number;
  readonly limit: number;
  readonly reason: string;
}

/** A movement that carries no balance: a debt, a provider fee, or a correction. */
export interface NoteInput {
  readonly accountId: string;
  readonly idempotencyKey: string;
  readonly at: string;
  readonly kind: "debt" | "fee" | "adjustment";
  readonly amount: Money;
  readonly entryId: string;
  readonly reference?: string;
  readonly reason: string;
}

export interface SpendResult {
  readonly ok: boolean;
  readonly duplicate: boolean;
  /** What could not be covered. Zero on success. */
  readonly shortfall: Money;
  readonly balance: Money;
  readonly reason: string;
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

  /**
   * Increment one post's counter and return the new total.
   *
   * A read-modify-write from concurrent requests loses counts, so both engines
   * do this as a single atomic operation rather than a get followed by a put.
   */
  recordBlogView(slug: string, at: string): Promise<BlogViewCount>;
  listBlogViews(): Promise<readonly BlogViewCount[]>;

  /* ------------------------------------------------------------- billing */

  getSubscription(accountId: string): Promise<Subscription | undefined>;
  listSubscriptions(): Promise<readonly Subscription[]>;
  saveSubscription(subscription: Subscription): Promise<Subscription>;

  /**
   * Take ownership of a provider event, once.
   *
   * Returns false if this id has already been handled. Providers redeliver by
   * design — a delivery that times out is sent again — so without this the
   * second delivery grants the balance a second time. The check and the claim
   * are one operation, or two concurrent deliveries both find it unclaimed.
   */
  claimBillingEvent(eventId: string, type: string, at: string): Promise<boolean>;

  listCreditLots(accountId: string): Promise<readonly CreditLot[]>;
  listLedgerEntries(accountId: string): Promise<readonly LedgerEntry[]>;

  /** Idempotent on `idempotencyKey`. */
  applyTopUp(input: TopUpInput): Promise<TopUpResult>;

  /**
   * Spend prepaid balance, all or nothing.
   *
   * The read of the balance and the write of the allocation are one atomic
   * operation. Anything less lets two requests both see enough balance and both
   * succeed, which is how a metered service gets used twice for one payment.
   */
  spendCredits(input: SpendInput): Promise<SpendResult>;

  /**
   * Reverse the lots from one payment, in proportion to the cash returned.
   *
   * A dispute takes everything back; a refund may be partial, and stripping
   * balance a customer still owns produces the second dispute — from a customer
   * who is by then correct. Whatever the reversal reaches beyond what is still
   * unspent is service already delivered, and is written as a debt.
   */
  reverseLotsForPayment(input: ReversalInput): Promise<ReversalResult>;

  /** Count one use of a plan allowance, atomically, against its limit. */
  recordAllowanceUse(input: AllowanceInput): Promise<AllowanceResult>;

  /** Append a movement that carries no balance. Idempotent, like every other. */
  recordNote(input: NoteInput): Promise<boolean>;

  /** Write off lapsed balance, recording an entry for each. */
  expireLapsedCredits(now: string, entryIdPrefix: string): Promise<number>;

  /** Append only. There is deliberately no update or delete. */
  appendAudit(event: AuditEvent): Promise<AuditEvent>;
  /** Most recent first. `subject` narrows to one deal or account. */
  listAudit(options?: { limit?: number; subject?: string }): Promise<readonly AuditEvent[]>;

  replaceAll(db: Database): Promise<void>;
  isEmpty(): Promise<boolean>;
}

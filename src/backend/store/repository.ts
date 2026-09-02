import type { BuyBox, FundingBox } from "@shared/domain/matching";
import type { RefundTrigger } from "@shared/domain/reveal";
import type { Subscriber } from "@shared/domain/newsletter";
import type { Account } from "@shared/domain/accounts";
import type { AgentDecision } from "@shared/domain/agents";
import { fileStore } from "@backend/store/fileStore";
import type {
  AllowanceInput,
  AllowanceResult,
  AuditEvent,
  BlogViewCount,
  NoteInput,
  ReversalInput,
  ReversalResult,
  SpendInput,
  SpendResult,
  DataRoomGrant,
  DealFee,
  RevealRecord,
  OutreachMessage,
  PendingCharge,
  StoredCandidate,
  Suppression,
  TopUpInput,
  TopUpResult,
  Database,
  DealRecord,
  Store,
  SubscriberTokenField,
} from "@backend/store/schema";

export type {
  AllowanceInput,
  AllowanceResult,
  AuditAction,
  AuditEvent,
  BlogViewCount,
  NoteInput,
  ReversalInput,
  ReversalResult,
  SpendInput,
  SpendResult,
  DataRoomGrant,
  DealFee,
  OutreachMessage,
  PendingCharge,
  StoredCandidate,
  Suppression,
  TopUpInput,
  TopUpResult,
  Database,
  DealRecord,
} from "@backend/store/schema";

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
    const { postgresStore } = await import("@backend/store/postgresStore");
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

// --- Accounts and audit ----------------------------------------------------

export async function listAccounts(): Promise<readonly Account[]> {
  return (await store()).listAccounts();
}

export async function getAccount(id: string): Promise<Account | undefined> {
  return (await store()).getAccount(id);
}

export async function findAccountByEmail(email: string): Promise<Account | undefined> {
  return (await store()).findAccountByEmail(email);
}

export async function saveAccount(account: Account): Promise<Account> {
  return (await store()).saveAccount(account);
}

/** Append only. There is deliberately no update or delete. */
/* ------------------------------------------------------------------ billing */

export async function getSubscription(accountId: string) {
  return (await store()).getSubscription(accountId);
}

export async function listSubscriptions() {
  return (await store()).listSubscriptions();
}

export async function saveSubscription(subscription: Parameters<Store["saveSubscription"]>[0]) {
  return (await store()).saveSubscription(subscription);
}

export async function claimBillingEvent(eventId: string, type: string, at: string) {
  return (await store()).claimBillingEvent(eventId, type, at);
}

export async function listCreditLots(accountId: string) {
  return (await store()).listCreditLots(accountId);
}

export async function listLedgerEntries(accountId: string) {
  return (await store()).listLedgerEntries(accountId);
}

export async function applyTopUp(input: TopUpInput): Promise<TopUpResult> {
  return (await store()).applyTopUp(input);
}

export async function spendCredits(input: SpendInput): Promise<SpendResult> {
  return (await store()).spendCredits(input);
}

export async function reverseLotsForPayment(input: ReversalInput): Promise<ReversalResult> {
  return (await store()).reverseLotsForPayment(input);
}

export async function listDiscoveryCandidates() {
  return (await store()).listDiscoveryCandidates();
}

export async function saveDiscoveryCandidate(entry: StoredCandidate) {
  return (await store()).saveDiscoveryCandidate(entry);
}

export async function listOutreachMessages() {
  return (await store()).listOutreachMessages();
}

export async function saveOutreachMessage(message: OutreachMessage) {
  return (await store()).saveOutreachMessage(message);
}

export async function listSuppressions() {
  return (await store()).listSuppressions();
}

export async function addSuppression(entry: Suppression) {
  return (await store()).addSuppression(entry);
}

export async function listDealFees(dealId: string) {
  return (await store()).listDealFees(dealId);
}

export async function raiseDealFee(fee: DealFee) {
  return (await store()).raiseDealFee(fee);
}

export async function voidDealFee(id: string, at: string, by: string, reason: string) {
  return (await store()).voidDealFee(id, at, by, reason);
}

export async function listRevealsForAccount(accountId: string) {
  return (await store()).listRevealsForAccount(accountId);
}

export async function listRevealsForDeal(dealId: string) {
  return (await store()).listRevealsForDeal(dealId);
}

export async function recordReveal(record: RevealRecord) {
  return (await store()).recordReveal(record);
}

export async function refundReveal(id: string, at: string, trigger: RefundTrigger, reason: string) {
  return (await store()).refundReveal(id, at, trigger, reason);
}

export async function listAgentDecisions(dealId: string) {
  return (await store()).listAgentDecisions(dealId);
}

export async function saveAgentDecision(decision: AgentDecision) {
  return (await store()).saveAgentDecision(decision);
}

export async function listDataRoomGrants() {
  return (await store()).listDataRoomGrants();
}

export async function getDataRoomGrant(token: string) {
  return (await store()).getDataRoomGrant(token);
}

export async function saveDataRoomGrant(grant: DataRoomGrant) {
  return (await store()).saveDataRoomGrant(grant);
}

export async function getPendingCharge(id: string) {
  return (await store()).getPendingCharge(id);
}

export async function savePendingCharge(charge: PendingCharge) {
  return (await store()).savePendingCharge(charge);
}

export async function recordAllowanceUse(input: AllowanceInput): Promise<AllowanceResult> {
  return (await store()).recordAllowanceUse(input);
}

export async function recordNote(input: NoteInput): Promise<boolean> {
  return (await store()).recordNote(input);
}

export async function expireLapsedCredits(now: string, entryIdPrefix: string) {
  return (await store()).expireLapsedCredits(now, entryIdPrefix);
}

export async function recordBlogView(slug: string, at: string): Promise<BlogViewCount> {
  return (await store()).recordBlogView(slug, at);
}

export async function listBlogViews(): Promise<readonly BlogViewCount[]> {
  return (await store()).listBlogViews();
}

export async function appendAudit(event: AuditEvent): Promise<AuditEvent> {
  return (await store()).appendAudit(event);
}

export async function listAudit(
  options?: { limit?: number; subject?: string },
): Promise<readonly AuditEvent[]> {
  return (await store()).listAudit(options);
}

/** True when the store has never been seeded. */
export async function isEmpty(): Promise<boolean> {
  return (await store()).isEmpty();
}

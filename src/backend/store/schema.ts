import type { BuyBox, FundingBox } from "@shared/domain/matching";
import type { DealInputs, DealStatus, PropertyFacts, SellerProfile } from "@shared/domain/types";
import type { ListingSignal } from "@shared/domain/goldmine";
import type { Milestone } from "@shared/domain/completion";
import type { FundingEvidence } from "@shared/domain/fundingReadiness";
import type { BorrowerFacts } from "@shared/domain/regulatoryRoute";
import type {
  Candidate,
  MessageChannel,
  MessageType,
  OutreachDecision,
} from "@shared/domain/outreach";
import type { Subscriber } from "@shared/domain/newsletter";
import type { Account } from "@shared/domain/accounts";
import type { Channel, LawfulBasis, Severity } from "@shared/domain/notifications";
import type { SellerEnquiryConsent } from "@shared/domain/sellerConsent";
import type { LeadSignal, SourcedLead } from "@shared/domain/sourcedLead";
import type { ImportedListing, SubmitterRole } from "@shared/domain/listingImport";
import type { AgentDecision } from "@shared/domain/agents";
import type {
  AgentInstruction,
  FeeDisclosure,
  FeeKey,
  FeePayer,
  SellerAgreement,
} from "@shared/domain/fees";
import type { InventoryCategory, InventoryItem, ConfirmedBy } from "@shared/domain/inventory";
import type { MaterialRecord } from "@shared/domain/materialInformation";
import type { SellerDueDiligence } from "@shared/domain/sellerDueDiligence";
import type { PayoutRecipient } from "@shared/domain/payouts";
import type { HoldingFacts } from "@shared/domain/portfolio";
import type { RefundTrigger } from "@shared/domain/reveal";
import type { OpportunityClass } from "@shared/domain/pricing";
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
  /**
   * The seller account that submitted this, where one was signed in.
   *
   * Absent for an operator-entered deal or a submission made with no account —
   * the /sell flow stays open to people who never register. When present it
   * lets a seller see their own submissions on their dashboard, scoped by
   * `canManageProperty`; it never widens who else may see the deal.
   */
  readonly ownerAccountId?: string;
  readonly listing?: ListingSignal;
  readonly milestones?: readonly Milestone[];
  /**
   * What can actually be proved about this deal, as opposed to modelled.
   *
   * Optional and absent by default. The readiness score reads it, and absence
   * scores zero rather than full marks — a title with nothing recorded about it
   * is not a clean title.
   */
  readonly evidence?: FundingEvidence;
  /**
   * The facts the regulatory route is classified from.
   *
   * Absent means unclassified, which routes to review rather than to permitted.
   */
  readonly borrowerFacts?: BorrowerFacts;
  /** Indicative or binding offers received, for the comparison in §10. */
  readonly offers?: readonly RecordedOffer[];
  /**
   * What the seller was told about our fees, and when.
   *
   * Held against the deal rather than against the invoice, because the Estate
   * Agents Act 1979 s.18 requires the client to be told before they are bound
   * — so a disclosure recorded at the moment of invoicing is by definition too
   * late, and a fee they were never told about is unenforceable.
   */
  readonly feeDisclosure?: FeeDisclosure;
  /**
   * What the seller signed, and for which service.
   *
   * Absent means nothing was signed, and the seller success fee is refused —
   * a percentage nobody agreed to is not a fee. The terms version is recorded
   * so a later repricing cannot be applied backwards to a signed agreement.
   */
  readonly sellerAgreement?: SellerAgreement;
  /**
   * What is known about this property after completion.
   *
   * Absent until it completes, and absent afterwards until somebody records
   * it. Recorded rather than derived because what a property is worth today,
   * what has been spent on it and what debt is against it are facts somebody
   * has to establish — the appraisal knows what they were projected to be,
   * which is a different thing entirely.
   */
  readonly holding?: HoldingFacts;
  /**
   * Where this opportunity came from, and whether anybody with authority over
   * the property has said it is for sale.
   *
   * Absent is read as AI-discovered and unconfirmed, which is the honest
   * default: the alternative is that an opportunity nobody entered a category
   * for reads as verified, and the whole point of the category is that it
   * cannot over-claim by accident.
   */
  readonly inventory?: InventoryItem;
  /**
   * The material information answers, keyed by item.
   *
   * Absent means nothing has been asked, which fails Part A and stops the
   * property being marketed. That is the correct default: a buyer cannot tell
   * the difference between "no covenants" and "nobody looked", and publishing
   * silence in place of the second is the misleading omission the Consumer
   * Protection Regulations are about.
   */
  readonly material?: MaterialRecord;
  /**
   * What has been checked about the seller.
   *
   * Absent means nothing has, which stops the property being marketed. The
   * Money Laundering Regulations make us responsible for both parties to the
   * transaction, and a seller nobody has looked at is exactly the seller they
   * exist for.
   */
  readonly sellerChecks?: SellerDueDiligence;
  /**
   * An estate-agency instruction already running on the property.
   *
   * Under sole agency or sole selling rights the existing agent is paid on a
   * sale whoever introduced the buyer, so charging on top of it makes the
   * seller pay twice for one completion. Recorded here so the fee engine can
   * refuse until the release is recorded.
   */
  readonly existingInstruction?: AgentInstruction;
  /**
   * The deal owner's consent to identify this transaction to a third party.
   *
   * Stage one is anonymous and needs nothing. Naming the property, the price or
   * the seller to somebody outside the platform is a disclosure, and it is the
   * owner's to give — not a step an agent clears by deciding the recipient
   * seems interested enough.
   */
  readonly disclosureConsent?: DisclosureConsent;
  /**
   * The seller's own consent at the point of enquiry: that they were shown the
   * privacy notice (and which version), and that they affirm they may sell.
   *
   * Absent on a deal the operator created or discovered rather than one a seller
   * submitted. Present on every enquiry, because the action refuses to write one
   * without it — a person's circumstances are not stored with no record of why.
   */
  readonly enquiryConsent?: SellerEnquiryConsent;
  readonly borrowerCompletedDeals: number;
  readonly status: DealStatus;
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

/**
 * One lender's terms, as received.
 *
 * Stored as the terms themselves rather than as a computed total, so the
 * comparison is recomputed from the engine every time. A stored total is a
 * figure that stops agreeing with the deal the moment the price or the term
 * changes.
 */
export interface RecordedOffer {
  readonly id: string;
  readonly lender: string;
  /** Basis points, as quoted. */
  readonly annualRateBps: number;
  readonly arrangementFeeBps: number;
  readonly brokerFeeBps: number;
  readonly exitFeeBps: number;
  readonly ltvBps: number;
  /** Valuation and legal costs the borrower bears, in pence. */
  readonly lenderCosts: number;
  readonly interestRolledUp: boolean;
  readonly termMonths: number;
  readonly confidence: "indicative" | "credit-backed" | "valuation-backed" | "binding";
  readonly receivedAt: string;
}

export interface DisclosureConsent {
  readonly at: string;
  readonly by: string;
  /** identified-teaser names the property; full-pack opens the memorandum. */
  readonly scope: "identified-teaser" | "full-pack";
  readonly note: string;
}

/**
 * Time-limited access to a deal's material, granted to one funder.
 *
 * A capability URL, like the seller's own result page: the token is the
 * credential. It expires, it is revocable, every opening is counted, and the
 * page it opens carries the recipient's name and the time it was produced —
 * so a copy that circulates says who it was given to.
 */
export interface DataRoomGrant {
  readonly token: string;
  readonly dealId: string;
  readonly candidateId: string;
  readonly organisationName: string;
  readonly grantedAt: string;
  readonly grantedBy: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  readonly revokedBy?: string;
  readonly accessCount: number;
  readonly lastAccessedAt?: string;
}

/**
 * A charge raised with the payment provider and not yet confirmed.
 *
 * Held so the amount asked for can be compared against the amount the webhook
 * later reports. Without it, a confirmation is taken on trust for whatever
 * figure it names.
 */
export interface PendingCharge {
  readonly id: string;
  readonly accountId: string;
  readonly description: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  /** What was bought, so fulfilment does not have to re-derive it. */
  readonly planId?: string;
  readonly packId?: string;
  readonly createdAt: string;
  readonly idempotencyKey: string;
  /** Where the provider sent the customer to pay. */
  readonly redirectUrl?: string;
  readonly settledAt?: string;
}

/** The profile images an account may set: one avatar, one cover. */
export const IMAGE_KINDS = ["avatar", "cover"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

/**
 * A stored profile image.
 *
 * Held in its own record rather than on the account, because the account is
 * read on every authenticated request (the guard loads it to check the
 * session) and an image on it would ship tens of kilobytes of base64 through
 * every one of those reads. The bytes are re-encoded on upload — resized to a
 * fixed box and written as WebP, which drops EXIF and any GPS a phone camera
 * embedded — so what is stored is never the original file.
 *
 * The id is `${accountId}:${kind}`, so a second upload of the same kind
 * replaces the first rather than accumulating.
 */
export interface AccountImage {
  readonly id: string;
  readonly accountId: string;
  readonly kind: ImageKind;
  /** Always an image/* type we produced, never the uploaded file's claim. */
  readonly contentType: string;
  /** Re-encoded, EXIF-stripped bytes, base64. */
  readonly dataBase64: string;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readonly createdAt: string;
}

/** The most photos one property may carry. A listing, not an album. */
export const MAX_DEAL_IMAGES = 8;

/**
 * One photo of a property.
 *
 * Held in its own record for the same reason as {@link AccountImage}: the deal
 * is read and scored constantly, and tens of kilobytes of base64 on it would
 * ride along through every appraisal. The bytes are re-encoded on upload —
 * resized and written as WebP, which drops EXIF and any GPS a phone camera
 * embedded, so a photo can never leak the address the reveal model exists to
 * protect. What is stored is a new file we produced, not the uploaded one.
 *
 * The id is `${dealId}:${position}`, where position is a 0-based slot, so a
 * re-upload to the same slot replaces rather than accumulates.
 */
export interface DealImage {
  readonly id: string;
  readonly dealId: string;
  /** 0-based display order. */
  readonly position: number;
  /** Always an image/* type we produced, never the uploaded file's claim. */
  readonly contentType: string;
  /** Re-encoded, EXIF-stripped bytes, base64. */
  readonly dataBase64: string;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  /** A short operator-written caption, never the address. */
  readonly caption?: string;
  readonly createdAt: string;
}

/**
 * One delivery of one event on one channel.
 *
 * Append-mostly: a row is written once per (event, recipient, channel) and only
 * ever gains a `readAt` when the recipient opens the in-app copy. The `id` is
 * the dedupe key the caller supplies, held unique by the store, so a retried
 * emit cannot double-send — the §24 money discipline applied to messages.
 */
export interface StoredNotification {
  readonly id: string;
  readonly eventKey: string;
  readonly recipientAccountId: string;
  readonly channel: Channel;
  readonly lawfulBasis: LawfulBasis;
  readonly severity: Severity;
  readonly status: "sent" | "logged" | "sandbox" | "failed" | "suppressed";
  readonly subject: string;
  readonly createdAt: string;
  /** Set when the in-app copy is read. Meaningful only for the inapp channel. */
  readonly readAt?: string;
}

export interface Database {
  deals: DealRecord[];
  buyBoxes: BuyBox[];
  fundingBoxes: FundingBox[];
  subscribers: Subscriber[];
  accounts: Account[];
  /**
   * Profile images, keyed `${accountId}:${kind}`. Optional so every database
   * literal and fixture written before this stays valid; readers default to
   * empty.
   */
  accountImages?: AccountImage[];
  /** Property photos, keyed `${dealId}:${position}`. Optional, as above. */
  dealImages?: DealImage[];
  /** Notification deliveries and the in-app inbox. Optional, as above. */
  notifications?: StoredNotification[];
  auditEvents: AuditEvent[];
  blogViews: BlogViewCount[];
  subscriptions: Subscription[];
  creditLots: CreditLot[];
  ledgerEntries: LedgerEntry[];
  /** Provider event ids already acted on. The webhook replay defence. */
  billingEvents: ProcessedEvent[];
  /** Funders found by discovery, quarantined until a person approves them. */
  discoveryCandidates: StoredCandidate[];
  /**
   * Property leads found by sourcing — the worklist. Optional so every existing
   * database literal and fixture stays valid; readers default to empty.
   */
  sourcedProperties?: StoredSourcedProperty[];
  /** Listings imported from a link by their rights-holder. Optional, as above. */
  importedListings?: StoredImportedListing[];
  /**
   * Leads already written to, suppressed from future runs. Only the stable key
   * is kept — never the distress lead itself. Optional, as above.
   */
  contactedLeads?: ContactedLead[];
  outreachMessages: OutreachMessage[];
  dataRoomGrants: DataRoomGrant[];
  pendingCharges: PendingCharge[];
  /**
   * What a named person decided about each agent proposal.
   *
   * Kept rather than recomputed because a proposal is a function of the deal as
   * it stands, and the deal moves. The decision has to survive the run that
   * produced it, or "the underwriter reviewed this" would silently become "the
   * underwriter reviewed something that no longer exists".
   */
  agentDecisions: AgentDecision[];
  /** Fees raised against a deal. Money, so each moves at most once. */
  dealFees: DealFee[];
  reveals: RevealRecord[];
  payoutRecipients: PayoutRecipient[];
  payouts: PayoutRecord[];
  /**
   * Addresses that must never be written to again, by address rather than by
   * candidate.
   *
   * The same mailbox can appear against several organisations, and somebody who
   * asked to be left alone asked once. Checked immediately before every send,
   * not when the message was drafted — a person can opt out in the minutes
   * between.
   */
  suppressions: Suppression[];
}

/**
 * Somebody who must not be written to again.
 *
 * Keyed by address rather than by candidate, because one person can appear
 * against several properties and somebody who asked to be left alone asked
 * once. `email` holds a mailbox or a normalised postal key depending on the
 * channel — one list, checked before every send of either kind, so an opt-out
 * by letter also stops the emails.
 */
export interface Suppression {
  readonly email: string;
  readonly channel?: MessageChannel;
  readonly reason: string;
  readonly at: string;
}

export type MessageStatus =
  | "draft"
  | "approved"
  | "sent"
  | "failed"
  | "refused"
  /** A letter rendered and waiting for somebody to print and post it. */
  | "queued-for-post"
  | "posted";

export interface OutreachMessage {
  readonly id: string;
  readonly candidateId: string;
  readonly dealId?: string;
  readonly messageType: MessageType;
  readonly channel: MessageChannel;
  /** An email address, or the addressee's name where this is a letter. */
  readonly to: string;
  /** The address block, on a letter. */
  readonly postalAddress?: string;
  /**
   * What was done to make a letter to an individual lawful.
   *
   * Stored on the message rather than passed in at draft time, because the
   * check that matters runs again immediately before sending — and a re-check
   * that cannot see the screening can never pass it.
   */
  readonly screening?: {
    readonly mpsScreened: boolean;
    readonly privacyNoticeIncluded: boolean;
    readonly legitimateInterestsRecorded: boolean;
  };
  readonly subject: string;
  readonly body: string;
  /** The eligibility decision at the time it was drafted. */
  readonly decision: OutreachDecision;
  readonly decisionReason: string;
  readonly status: MessageStatus;
  readonly createdAt: string;
  readonly approvedAt?: string;
  readonly approvedBy?: string;
  readonly sentAt?: string;
  readonly failureReason?: string;
  /** Inbound reply text, where one has been received. */
  readonly replyReceivedAt?: string;
  readonly replyClassification?: string;
  /** Set where the provider reported the message could not be delivered. */
  readonly bouncedAt?: string;
  /** When a letter was actually put in the post, by whom. */
  readonly postedAt?: string;
  readonly postedBy?: string;
}

/**
 * A discovered funder, and what was done about it.
 *
 * Quarantined on arrival. The specification allows auto-creating a funder
 * record in a research state, and this is that state: it exists, it is
 * reviewable, and nothing may be sent to it until somebody has looked.
 */
export interface StoredCandidate {
  readonly candidate: Candidate;
  /** What the run did and did not take, in the order it happened. */
  readonly notes: readonly string[];
  readonly discoveredAt: string;
  /** Set when a person approved it for outreach. Absent means quarantined. */
  readonly approvedAt?: string;
  readonly approvedBy?: string;
}

/**
 * A property lead found by sourcing, kept as a worklist.
 *
 * Only property-fact leads are warehoused — `prepared-but-unsold`, which is a
 * postcode, dates and an EPC rating, and identifies nobody. The distress leads
 * (probate, insolvency, negative equity) are deliberately NOT stored: they
 * concern a person's death or financial failure, and the platform's stance is
 * that such data is acted on live by a named person, not accumulated in a
 * queue. Warehousing a list of the recently bereaved or the insolvent is
 * exactly the thing data minimisation exists to prevent, so the store cannot
 * hold one.
 *
 * `id` is the address key, so a rerun updates the same row rather than piling
 * duplicates, and `firstSeenAt` and a dismissal both survive that rerun — a
 * fresh dataset does not get to forget that somebody already set this aside.
 */
export interface StoredSourcedProperty {
  readonly id: string;
  readonly lead: SourcedLead;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  /** Set aside by a named person, with a reason. Survives a rerun. */
  readonly dismissed?: { readonly at: string; readonly by: string; readonly reason: string };
}

/**
 * A lead already written to, so it is suppressed from every future sourcing run.
 *
 * The purpose is to stop the same property or estate being printed and posted to
 * twice — a second letter is a waste at best and, on a probate or insolvency
 * notice, exactly the repeated approach the protections guard against.
 *
 * `key` is the lead's own stable identity: the address key for a
 * prepared-but-unsold property (the same id the worklist uses), the public
 * notice URL for a probate or insolvency notice. That is deliberately ALL this
 * holds. It is not a warehouse of the bereaved or the insolvent — the distress
 * leads are still never stored (§59, data minimisation). A Gazette notice URL is
 * a public reference, not a person's details, and keeping it to prevent a second
 * approach is the conduct the protections want, not the thing they forbid. It is
 * reversible: a named person can clear a mark and the lead returns on the next run.
 */
export interface ContactedLead {
  readonly key: string;
  readonly signalKey: LeadSignal;
  readonly contactedAt: string;
  readonly by: string;
  /**
   * The minimum needed to start a deal from this lead later — and nothing more.
   *
   * Captured when a probate or insolvency lead is written to, so "Start a deal"
   * still works from the Contacted list once the live notice has rotated out of
   * the Gazette feed. This is the one place such a lead's facts are kept, and
   * it is deliberately three fields: postcode, address, the subject's name. It
   * is lawful here because the operator has chosen to ACT on this lead (they
   * printed to it) — the same basis as starting a deal — and it is reversible:
   * clearing the suppression (Restore) deletes this with it. Absent for a
   * prepared-but-unsold lead, whose facts are already in the worklist.
   */
  readonly startFacts?: {
    readonly postcode?: string;
    readonly address?: string;
    readonly subjectName?: string;
  };
}

/**
 * A listing imported from a link by the rights-holder.
 *
 * It carries the facts taken from the page, who submitted it and in what
 * capacity, the inventory category that follows from that, and the named person
 * who warranted the right to publish it. A draft until the appraisal and the
 * seller checks the pipeline requires are done — importing facts does not make a
 * property marketable on its own.
 */
export interface StoredImportedListing {
  readonly id: string;
  readonly listing: ImportedListing;
  readonly role: SubmitterRole;
  readonly category: InventoryCategory;
  readonly confirmedBy: ConfirmedBy;
  /** The named person who warranted the right to publish it. */
  readonly warrantedBy: string;
  /**
   * The account that owns this listing, where a partner imported it. Absent for
   * an operator import. A partner sees and may withdraw only listings whose
   * owner is their own account.
   */
  readonly ownerAccountId?: string;
  readonly submittedAt: string;
  readonly status: "draft" | "withdrawn";
}

/**
 * A fee raised against one deal.
 *
 * The amount is stored, unlike almost everything else here, because an invoice
 * is a statement made on a date. Every other figure on this platform is
 * recomputed so it cannot go stale; this one must not change after it has been
 * sent, and the appraisal it was derived from will move.
 */
export interface DealFee {
  readonly id: string;
  readonly dealId: string;
  readonly feeKey: FeeKey;
  readonly payer: FeePayer;
  /** Pence, as invoiced. Frozen at the moment it was raised. */
  readonly amount: Money;
  /** The basis stated to the payer, verbatim. */
  readonly basis: string;
  readonly raisedAt: string;
  readonly raisedByAccountId: string;
  readonly raisedByName: string;
  /** The disclosure that made it collectable, copied in at the time. */
  readonly disclosure?: FeeDisclosure;
  /** Which permissions were recorded as held when it was raised. */
  readonly permissionsAtRaise: readonly string[];
  readonly note: string;
  /** Set when the fee is withdrawn. Fees are never deleted. */
  readonly voidedAt?: string;
  readonly voidedBy?: string;
  readonly voidReason?: string;
}

/**
 * One buyer opening one opportunity.
 *
 * The amount, the category and the sentence the buyer was shown are all frozen
 * here rather than recomputed. Every other figure on this platform is
 * recomputed so it cannot go stale; these three are the terms of a sale that
 * happened, and if the property is later reclassified the buyer must still be
 * able to see what they were told at the time — it is the whole basis of the
 * refund.
 */
export interface RevealRecord {
  readonly id: string;
  readonly dealId: string;
  readonly accountId: string;
  readonly opportunity: OpportunityClass;
  /** Pence taken, frozen at the moment of sale. */
  readonly paid: Money;
  readonly paidAt: string;
  readonly categoryAtPurchase: InventoryCategory;
  /** The category sentence shown, verbatim. */
  readonly disclosureShown: string;
  /**
   * Held unique by the store.
   *
   * A reveal is money and money moves at most once. The key is the check, not
   * a read-then-write in application code.
   */
  readonly idempotencyKey: string;
  readonly refundedAt?: string;
  readonly refundTrigger?: RefundTrigger;
  readonly refundReason?: string;
}

/**
 * One payment out.
 *
 * Recorded before the provider is called and settled afterwards, the same way
 * a pending charge works and for the same reason: a transfer that exists only
 * in the provider's records is money nothing here can account for — and in
 * this direction it has already gone.
 */
export interface PayoutRecord {
  readonly id: string;
  readonly recipientId: string;
  /** What this is a share of. A deal, or a collected payment. */
  readonly sourceReference: string;
  readonly amount: Money;
  readonly currency: string;
  /** The whole payment this is a share of, for the reconciliation. */
  readonly gross: Money;
  /** How the split was arrived at, verbatim, as it was stated at the time. */
  readonly basis: string;
  /** ISO-8601, when the money it comes from was collected. */
  readonly collectedAt: string;
  readonly createdAt: string;
  /** Who authorised it. Named — a payout is somebody deciding to send money. */
  readonly authorisedBy: string;
  /** Held unique by the store. Money moves at most once. */
  readonly idempotencyKey: string;
  /** Set when the provider confirms it has gone. */
  readonly settledAt?: string;
  /** The provider's transfer id, so it can be traced. */
  readonly transferReference?: string;
  /** Set where the transfer failed. The record stays either way. */
  readonly failedAt?: string;
  readonly failureReason?: string;
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
  | "access-denied"
  | "agents-run"
  | "agent-proposal-accepted"
  | "agent-proposal-dismissed"
  | "fee-raised"
  | "fee-voided"
  | "fee-disclosure-recorded"
  | "seller-agreement-recorded"
  | "seller-instruction-recorded"
  | "opportunity-opened"
  | "opportunity-refunded"
  | "passport-evidence-recorded"
  | "material-information-recorded"
  | "seller-checks-recorded"
  | "payout-recipient-recorded"
  | "payout-made"
  | "payout-failed"
  | "holding-recorded"
  | "sale-confirmation-recorded"
  | "subscription-comped";

export type SubscriberTokenField = "confirmToken" | "unsubscribeToken";

export interface Store {
  readonly kind: "file" | "postgres";

  /**
   * Every deal. Unbounded, and increasingly the wrong call.
   *
   * Kept for the places that genuinely need the whole set — the supply count,
   * the blog corpus, a reseed — and left unbounded there because a partial
   * answer to "how many are there" is a wrong answer. Anything rendering a
   * list wants `pageDeals()`.
   */
  listDeals(): Promise<readonly DealRecord[]>;
  /**
   * A page of deals, newest first, and the total.
   *
   * Added because every listing surface loaded the entire table and then
   * scored every row: `/invest` is O(deals x boxes) and cost 18 seconds of
   * blocking CPU at five thousand deals against five hundred mandates. On a
   * single-threaded runtime that is not a slow page, it is an outage for
   * everybody on the instance.
   *
   * The total is returned alongside rather than fetched separately, so a page
   * can say "12 of 4,310" without a second round trip and without the count
   * disagreeing with the rows.
   */
  pageDeals(limit: number, offset: number): Promise<{
    readonly rows: readonly DealRecord[];
    readonly total: number;
  }>;
  /**
   * The deals a seller account submitted, newest first.
   *
   * Scoped by `ownerAccountId` so a seller's dashboard reads only their own
   * submissions without loading the whole table — the seller counterpart to
   * `listRevealsForAccount`. Operators still use `pageDeals`/`listDeals`; this
   * is never a path to another account's deal.
   */
  listDealsForOwner(ownerAccountId: string): Promise<readonly DealRecord[]>;
  getDeal(id: string): Promise<DealRecord | undefined>;
  saveDeal(deal: DealRecord): Promise<DealRecord>;
  /** Remove a deal by id. True if a row was deleted, false if none matched. */
  deleteDeal(id: string): Promise<boolean>;

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

  /** One profile image, or undefined. Keyed by account and kind. */
  getAccountImage(accountId: string, kind: ImageKind): Promise<AccountImage | undefined>;
  /** Upsert: a second upload of the same kind replaces the first. */
  saveAccountImage(image: AccountImage): Promise<AccountImage>;
  /** Returns whether anything was removed. */
  deleteAccountImage(accountId: string, kind: ImageKind): Promise<boolean>;

  /** One property photo, or undefined. Keyed by deal and position. */
  getDealImage(dealId: string, position: number): Promise<DealImage | undefined>;
  /** Every photo for a deal, ordered by position. */
  listDealImages(dealId: string): Promise<readonly DealImage[]>;
  /** Upsert: a re-upload to the same position replaces it. */
  saveDealImage(image: DealImage): Promise<DealImage>;
  /** Returns whether anything was removed. */
  deleteDealImage(dealId: string, position: number): Promise<boolean>;

  /**
   * Record one notification delivery, once. `created` is false if this id was
   * already written — the replay defence, so a retried emit cannot double-send.
   */
  recordNotification(notification: StoredNotification): Promise<{ created: boolean }>;
  /** This account's notifications, newest first (the in-app inbox reads these). */
  listNotificationsForAccount(accountId: string): Promise<readonly StoredNotification[]>;
  /** Mark one in-app notification read. Returns whether it changed. */
  markNotificationRead(id: string): Promise<boolean>;

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

  listDiscoveryCandidates(): Promise<readonly StoredCandidate[]>;
  listOutreachMessages(): Promise<readonly OutreachMessage[]>;
  saveOutreachMessage(message: OutreachMessage): Promise<OutreachMessage>;
  listSuppressions(): Promise<readonly Suppression[]>;

  /** Fees raised against a deal, most recent first. */
  listDealFees(dealId: string): Promise<readonly DealFee[]>;
  /**
   * Raise a fee, once.
   *
   * Returns false where a live fee of this kind already exists on this deal —
   * the check and the write are one operation, because two people pressing the
   * button at the same time is exactly how a client gets invoiced twice.
   */
  raiseDealFee(fee: DealFee): Promise<boolean>;
  /** Void a fee. Never a delete: an invoice that was sent happened. */
  voidDealFee(id: string, at: string, by: string, reason: string): Promise<boolean>;

  /** Every opportunity this account has opened, most recent first. */
  listRevealsForAccount(accountId: string): Promise<readonly RevealRecord[]>;
  /** Every buyer who has opened this opportunity. */
  listRevealsForDeal(dealId: string): Promise<readonly RevealRecord[]>;
  /**
   * Record a reveal, once.
   *
   * Returns false where the idempotency key has already been used — the key is
   * held unique by the store, so a retried payment confirmation cannot charge a
   * buyer twice for the same introduction.
   */
  recordReveal(record: RevealRecord): Promise<boolean>;
  /**
   * Refund a reveal, once.
   *
   * Returns false where it is already refunded. The record is never deleted:
   * a sale that happened happened, and the refund is a second fact about it.
   */
  refundReveal(id: string, at: string, trigger: RefundTrigger, reason: string): Promise<boolean>;

  listPayoutRecipients(): Promise<readonly PayoutRecipient[]>;
  getPayoutRecipient(id: string): Promise<PayoutRecipient | undefined>;
  savePayoutRecipient(recipient: PayoutRecipient): Promise<PayoutRecipient>;

  listPayouts(): Promise<readonly PayoutRecord[]>;
  /**
   * Record a payout, once.
   *
   * Returns false where the idempotency key has already been used. Money going
   * out is more dangerous than money coming in — a duplicate payment in is
   * refundable and a duplicate payment out is gone — so the key is the check
   * and it is held by the store, never by a read before a write.
   */
  recordPayout(payout: PayoutRecord): Promise<boolean>;
  /** Mark a payout settled or failed. Never deletes: it happened either way. */
  closePayout(
    id: string,
    outcome:
      | { readonly settledAt: string; readonly transferReference: string }
      | { readonly failedAt: string; readonly failureReason: string },
  ): Promise<boolean>;

  /** Every decision on this deal, most recent first. */
  listAgentDecisions(dealId: string): Promise<readonly AgentDecision[]>;
  /** Append-only in effect: a change of mind is a new decision, not an edit. */
  saveAgentDecision(decision: AgentDecision): Promise<AgentDecision>;

  listDataRoomGrants(): Promise<readonly DataRoomGrant[]>;
  getDataRoomGrant(token: string): Promise<DataRoomGrant | undefined>;
  saveDataRoomGrant(grant: DataRoomGrant): Promise<DataRoomGrant>;

  getPendingCharge(id: string): Promise<PendingCharge | undefined>;
  savePendingCharge(charge: PendingCharge): Promise<PendingCharge>;
  /** Idempotent. Returns false where the address was already suppressed. */
  addSuppression(entry: Suppression): Promise<boolean>;
  /** Upsert by candidate id. Approval and suppression are never overwritten. */
  saveDiscoveryCandidate(entry: StoredCandidate): Promise<StoredCandidate>;

  /** The property-lead worklist, most recently seen first. */
  listSourcedProperties(): Promise<readonly StoredSourcedProperty[]>;
  /** Upsert by address key. firstSeenAt and a dismissal survive a rerun. */
  saveSourcedProperty(entry: StoredSourcedProperty): Promise<StoredSourcedProperty>;

  /** Leads already written to and therefore suppressed from future results. */
  listContactedLeads(): Promise<readonly ContactedLead[]>;
  /** Idempotent upsert by key. Returns false where the key was already marked. */
  markContactedLead(entry: ContactedLead): Promise<boolean>;
  /** Clear a mark so the lead can resurface. Returns true if one was removed. */
  clearContactedLead(key: string): Promise<boolean>;

  /** Listings imported by their rights-holder, most recent first. */
  listImportedListings(): Promise<readonly StoredImportedListing[]>;
  /** Upsert by id (the normalised source URL). submittedAt survives a re-import. */
  saveImportedListing(entry: StoredImportedListing): Promise<StoredImportedListing>;

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

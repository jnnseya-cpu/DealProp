import {
  categoryDefinition,
  UK_INVESTOR_CATEGORISATION,
  type InvestorCategory,
} from "@shared/domain/jurisdictions/uk-financial-promotion";
import type { PassportEvidence } from "@shared/domain/passport";

/**
 * Accounts, roles and what each may see.
 *
 * The shared operator password closed a data-exposure hole and is not a user
 * system: no per-person attribution, no audit trail, no way to tell one
 * investor from another. This is the replacement, and it is deliberately small.
 *
 * The thing that actually gates deal material is not the account, it is the
 * **categorisation**: a dated self-certification under the Financial Promotion
 * Order, renewed annually. `mayReceiveDealMaterial()` is the single place that
 * decision is made, so no page can accidentally get it right in one place and
 * wrong in another.
 *
 * Pure, framework-free and fully tested, like every other domain module. The
 * store holds accounts; this decides what they can do.
 */

export type Role =
  /** Full access, including managing accounts. */
  | "admin"
  /** Runs the pipeline. Sees seller data because the job requires it. */
  | "operator"
  /** External. Sees deal material only once categorised. */
  | "investor"
  /** External. Sees deal material only once categorised. */
  | "funder"
  /**
   * External. An estate agent or auctioneer who lists their own stock here.
   * May import and manage their OWN listings and nothing else — no seller data,
   * no mandates, no deal material.
   */
  | "partner"
  /**
   * External. Someone selling their own property. Holds the least privilege of
   * any role: they may submit a property and track the ones they submitted while
   * signed in, and nothing else — never another seller's enquiry, never a
   * mandate, never deal material. The /sell flow stays open to people with no
   * account at all (a capability link to their options); a seller account simply
   * ties their submissions to a login and a dashboard.
   */
  | "seller";

export type Permission =
  | "manage-accounts"
  /** The pipeline and Deal Room, which carry seller screening answers. */
  | "view-seller-data"
  /** Investment memoranda and deal packs. A financial promotion. */
  | "view-deal-material"
  /**
   * Create and edit ANY Buy Box or Funding Box, including those belonging to
   * other accounts. An operator power: it also gates discovery and outreach,
   * which draft letters to property owners, so it must never be handed to a
   * customer. The customer equivalent is `manage-own-mandates`.
   */
  | "manage-mandates"
  /**
   * Create and edit one's own mandates, and no one else's.
   *
   * The self-service permission. An investor or funder holds this and reaches
   * /invest or /capital to run their own Buy Box or Funding Box; the row-level
   * ownership check in `canManageMandate` is what keeps "own" honest. It
   * deliberately does NOT carry the operator surfaces `manage-mandates` does.
   */
  | "manage-own-mandates"
  /**
   * Import and manage one's OWN listings, and no one else's.
   *
   * The partner self-service permission. An estate agent or auctioneer holds it
   * and reaches `/account/listings` to import their own stock; the row-level
   * ownership check in `canManageImport` keeps "own" honest. It carries nothing
   * else — a partner never sees seller data, a mandate or deal material.
   */
  | "import-own-listings"
  /**
   * Submit and track one's OWN property, and no one else's.
   *
   * The seller self-service permission. A seller holds it and reaches `/account`
   * to submit a property and see the ones they submitted; ownership by
   * `ownerAccountId` on the deal keeps "own" honest. It carries nothing else — a
   * seller never sees another enquiry, a mandate or deal material.
   */
  | "manage-own-property"
  | "view-audit-log"
  /**
   * Blog performance: view counts and the SEO audit.
   *
   * Its own permission rather than borrowing one, because it is the only
   * operator surface that carries no seller information at all — a marketing
   * hire needs it and must not thereby be handed the pipeline.
   */
  | "view-content-performance";

/**
 * What each role may do, before categorisation is considered.
 *
 * Investors and funders hold no seller-data permission at any point. A funder
 * needs the deal, not the seller's reported health concerns, and the least
 * privilege that does the job is the one to grant.
 */
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: [
    "manage-accounts",
    "view-seller-data",
    "view-deal-material",
    "manage-mandates",
    "import-own-listings",
    "view-audit-log",
    "view-content-performance",
  ],
  operator: [
    "view-seller-data",
    "view-deal-material",
    "manage-mandates",
    "view-content-performance",
  ],
  investor: ["view-deal-material", "manage-own-mandates"],
  funder: ["view-deal-material", "manage-own-mandates"],
  // A partner lists their own stock and nothing more. No seller data, no
  // mandates, no deal material — the least privilege that does the job.
  partner: ["import-own-listings"],
  // A seller submits and tracks their own property and nothing more. The
  // smallest grant on the platform.
  seller: ["manage-own-property"],
};

export interface InvestorCertification {
  readonly category: InvestorCategory;
  /** Keys of the criteria the investor said were true of them. Never empty. */
  readonly criteriaMet: readonly string[];
  /** ISO-8601 timestamp of the signature. */
  readonly certifiedAt: string;
  /** The exact statement signed, kept verbatim as the evidence. */
  readonly statementText: string;
  /** Which snapshot of the rules the statement was made against. */
  readonly rulesAsOf: string;
}

export interface Account {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  /**
   * The primary role, kept as a single value for display and for the audit
   * trail's "as a ___" line. Permissions come from the union of this and
   * {@link Account.roles} via {@link accountRoles}.
   */
  readonly role: Role;
  /**
   * Any further roles this person holds beyond the primary one.
   *
   * People are rarely one thing: a flipper buys and sells, an agent may also
   * invest. Rather than make them keep several accounts, an account carries a
   * set of roles and `can()` grants a permission held by ANY of them. Optional
   * and absent by default, so every existing account stays valid and reads as
   * single-role. Self-service sign-up may only ever set roles from
   * {@link SELF_SERVICE_ROLES}; a staff role is added by an administrator.
   */
  readonly roles?: readonly Role[];
  /**
   * Set where this account is Lode itself, or a party connected to Lode, acting
   * as a buyer/flipper/funder rather than an independent third party.
   *
   * It is a disclosure flag, not a permission: where a connected party
   * participates in a deal the seller must be told they are dealing with the
   * house, not a neutral market (a conflict of interest the CPRs and fair
   * dealing require be disclosed). Never settable at self-service sign-up — a
   * person cannot declare themselves the house — only by an administrator.
   */
  readonly connectedParty?: boolean;
  /** scrypt hash and salt. Never the password. */
  readonly passwordHash: string;
  readonly passwordSalt: string;
  readonly createdAt: string;
  /** Set when access is withdrawn. Disabled accounts keep their audit trail. */
  readonly disabledAt?: string;
  /**
   * When this account last started a free trial.
   *
   * Recorded so a second one cannot be started. A trial is the one thing on the
   * platform that hands over the product for nothing, and a trial that can be
   * restarted is a subscription nobody ever has to buy — the cost of finding
   * that out is a month of product per attempt.
   */
  readonly trialClaimedAt?: string;
  readonly certification?: InvestorCertification;
  /**
   * What has been checked about this buyer, for the Buyer Readiness Passport.
   *
   * Held on the account rather than on a deal because it is a fact about the
   * person, not about a purchase: the same identity check and the same funds
   * evidence apply to every opportunity they look at. The grade is derived
   * from it against the price and the date, never stored — the same rule
   * entitlement follows, and for the same reason.
   */
  readonly passportEvidence?: PassportEvidence;
}

/** An account as it may safely be rendered or logged. */
export interface PublicAccount {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly roles?: readonly Role[];
  readonly connectedParty?: boolean;
  readonly disabled: boolean;
  readonly certification?: InvestorCertification;
}

/** Strips the credential. Use wherever an account crosses a boundary. */
export function publicAccount(account: Account): PublicAccount {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    role: account.role,
    ...(account.roles !== undefined ? { roles: account.roles } : {}),
    ...(account.connectedParty === true ? { connectedParty: true } : {}),
    disabled: account.disabledAt !== undefined,
    ...(account.certification !== undefined ? { certification: account.certification } : {}),
  };
}

/**
 * Every role this account holds, primary first, de-duplicated.
 *
 * The one place "what is this person" is answered, so `can()` and every caller
 * read the same union. A single-role account (no `roles`) returns just its one
 * role, so nothing about the old model changes.
 */
export function accountRoles(account: Pick<Account, "role" | "roles">): readonly Role[] {
  const extra = (account.roles ?? []).filter((r) => r !== account.role);
  return [account.role, ...extra];
}

/** Whether this account is Lode or a connected party acting as a principal. */
export function isConnectedParty(account: Pick<Account, "connectedParty">): boolean {
  return account.connectedParty === true;
}

/**
 * The sentence shown to a seller when a connected party participates.
 *
 * Plain and unmissable: the seller is dealing with the house, not an
 * independent buyer. Rendered wherever such a party's offer or interest reaches
 * a seller, so the conflict is disclosed rather than implied.
 */
export const CONNECTED_PARTY_DISCLOSURE =
  "This party is Lode or connected to Lode — a principal buyer, not an independent third party. Consider taking independent advice.";

/** Months between two ISO timestamps, floored. */
function monthsSince(iso: string, now: Date): number {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return Number.POSITIVE_INFINITY;
  return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
}

export interface CertificationStatus {
  readonly held: boolean;
  readonly current: boolean;
  readonly category: InvestorCategory;
  /** ISO date the certification lapses, where one is held. */
  readonly expiresAt?: string;
  readonly reason: string;
}

/**
 * Whether a certification is still good.
 *
 * An expired statement is not a weaker statement, it is no statement: sending
 * deal material on the strength of one is an unlawful promotion just as surely
 * as sending it to somebody who never certified at all. Hence `current` rather
 * than a score.
 */
export function certificationStatus(
  account: Pick<Account, "certification">,
  now: Date = new Date(),
): CertificationStatus {
  const cert = account.certification;
  if (cert === undefined) {
    return {
      held: false,
      current: false,
      category: "none",
      reason: "No investor certification has been given.",
    };
  }

  const age = monthsSince(cert.certifiedAt, now);
  const validFor = UK_INVESTOR_CATEGORISATION.certificationValidMonths;
  const expiry = new Date(cert.certifiedAt);
  expiry.setMonth(expiry.getMonth() + validFor);
  const expiresAt = expiry.toISOString().slice(0, 10);

  if (age >= validFor) {
    return {
      held: true,
      current: false,
      category: cert.category,
      expiresAt,
      reason: `The certification was signed ${age} months ago and lapsed after ${validFor}. It must be given again before any deal material is sent.`,
    };
  }

  const definition = categoryDefinition(cert.category);
  if (definition === undefined || !definition.mayReceiveDealMaterial) {
    return {
      held: true,
      current: false,
      category: cert.category,
      expiresAt,
      reason: `A ${definition?.label ?? cert.category} may not be sent this description of investment.`,
    };
  }

  return {
    held: true,
    current: true,
    category: cert.category,
    expiresAt,
    reason: `Certified as ${definition.label} under ${definition.citation}, valid until ${expiresAt}.`,
  };
}

export interface AccessDecision {
  readonly allowed: boolean;
  /** Always populated, allowed or not. No bare yes or no. */
  readonly reason: string;
}

/**
 * The single place a permission decision is made.
 *
 * Deal material carries the extra test: an external account must hold a current
 * certification on top of the role. Staff do not, because a promotion made to
 * one's own colleagues is not a promotion to an investor.
 */
export function can(
  account: Pick<Account, "role" | "roles" | "disabledAt" | "certification">,
  permission: Permission,
  now: Date = new Date(),
): AccessDecision {
  if (account.disabledAt !== undefined) {
    return { allowed: false, reason: "This account has been disabled." };
  }

  const roles = accountRoles(account);
  // Held by ANY role the account carries: a flipper (buyer + seller) may do
  // everything either role allows, decided here so no call site reinvents it.
  const granting = roles.find((r) => ROLE_PERMISSIONS[r].includes(permission));
  if (granting === undefined) {
    return {
      allowed: false,
      reason: `${article(account.role)} ${account.role} account cannot ${PERMISSION_LABELS[permission]}.`,
    };
  }

  // Deal material carries the extra test for an external account. Staff do not
  // certify — a promotion to one's own colleagues is not a promotion to an
  // investor — so an account that is also staff skips the gate.
  const staff = roles.includes("admin") || roles.includes("operator");
  if (permission === "view-deal-material" && !staff) {
    const status = certificationStatus(account, now);
    if (!status.current) {
      return { allowed: false, reason: status.reason };
    }
    return { allowed: true, reason: status.reason };
  }

  return { allowed: true, reason: `Granted by the ${granting} role.` };
}

/**
 * Whether this account may manage one particular mandate.
 *
 * The one place the ownership question is decided, so no call site reads a
 * role or an owner id and invents its own rule. Two ways in, and only two:
 *
 *  - `manage-mandates` manages any mandate. Operators and admins hold it; it
 *    is how a mandate gets created on a customer's behalf.
 *  - `manage-own-mandates` manages a mandate the account owns, and nothing
 *    else. Investors and funders hold it.
 *
 * A mandate with no owner recorded (every operator-created one today) can be
 * managed only by `manage-mandates` — a self-service account cannot adopt an
 * ownerless mandate by claiming it, because `ownerAccountId === account.id`
 * is false when the first side is undefined.
 */
export function canManageMandate(
  account: Pick<Account, "id" | "role" | "disabledAt" | "certification">,
  mandateOwnerId: string | undefined,
  now: Date = new Date(),
): AccessDecision {
  const any = can(account, "manage-mandates", now);
  if (any.allowed) return any;

  const own = can(account, "manage-own-mandates", now);
  if (!own.allowed) return own;

  if (mandateOwnerId === account.id) {
    return { allowed: true, reason: "Granted: the account owns this mandate." };
  }
  return {
    allowed: false,
    reason: "That mandate belongs to another account.",
  };
}

/**
 * Whether this account sees every mandate or only its own.
 *
 * The listing counterpart to `canManageMandate`. An operator browsing /invest
 * is administering the platform and sees all; a customer there is running
 * their own book and must see only it — both because another buyer's criteria
 * are not theirs to read, and because the page would otherwise leak the shape
 * of the platform's demand to anyone who paid for a plan.
 */
export function managesAllMandates(
  account: Pick<Account, "role" | "disabledAt" | "certification">,
  now: Date = new Date(),
): boolean {
  return can(account, "manage-mandates", now).allowed;
}

/**
 * Whether this account may import or manage a particular listing.
 *
 * The listing counterpart to `canManageMandate`. An operator (via
 * `manage-mandates`) manages every import; a partner manages only their own,
 * and the ownership check is what keeps that honest — a partner must never be
 * able to withdraw, or even see, a listing another firm submitted.
 */
export function canManageImport(
  account: Pick<Account, "id" | "role" | "disabledAt" | "certification">,
  listingOwnerId: string | undefined,
  now: Date = new Date(),
): AccessDecision {
  const any = can(account, "manage-mandates", now);
  if (any.allowed) return any;

  const own = can(account, "import-own-listings", now);
  if (!own.allowed) return own;

  if (listingOwnerId === account.id) {
    return { allowed: true, reason: "Granted: the account owns this listing." };
  }
  return { allowed: false, reason: "That listing belongs to another account." };
}

/** Whether this account sees every imported listing or only its own. */
export function managesAllImports(
  account: Pick<Account, "role" | "disabledAt" | "certification">,
  now: Date = new Date(),
): boolean {
  return can(account, "manage-mandates", now).allowed;
}

/**
 * Whether this account may see or manage a particular property submission.
 *
 * The seller counterpart to `canManageMandate`. An operator (via
 * `view-seller-data`) works every deal; a seller sees only the properties they
 * submitted, and the ownership check is what keeps that honest — a seller must
 * never reach another seller's enquiry, which is the most sensitive data on the
 * platform.
 */
export function canManageProperty(
  account: Pick<Account, "id" | "role" | "disabledAt" | "certification">,
  propertyOwnerId: string | undefined,
  now: Date = new Date(),
): AccessDecision {
  const staff = can(account, "view-seller-data", now);
  if (staff.allowed) return staff;

  const own = can(account, "manage-own-property", now);
  if (!own.allowed) return own;

  if (propertyOwnerId === account.id) {
    return { allowed: true, reason: "Granted: the account owns this property submission." };
  }
  return { allowed: false, reason: "That property belongs to another account." };
}


function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "An" : "A";
}

/** What each permission lets somebody do, in a sentence rather than a slug. */
const PERMISSION_LABELS: Record<Permission, string> = {
  "manage-accounts": "manage accounts",
  "view-seller-data": "see seller enquiries, which carry information given to us in confidence",
  "view-deal-material": "be sent deal material",
  "manage-mandates": "create or edit any mandate",
  "manage-own-mandates": "create or edit their own mandates",
  "import-own-listings": "import and manage their own listings",
  "manage-own-property": "submit and track their own property",
  "view-audit-log": "read the audit trail",
  "view-content-performance": "see how the blog is performing",
};

/** Convenience for the common question, keeping the reason available. */
export function mayReceiveDealMaterial(
  account: Pick<Account, "role" | "disabledAt" | "certification">,
  now: Date = new Date(),
): AccessDecision {
  return can(account, "view-deal-material", now);
}

export interface TrialDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

/**
 * Whether this account may start a free trial.
 *
 * One per account, ever. This does not stop somebody registering a second
 * account with a second address — nothing in software does, and pretending
 * otherwise is worse than knowing it — but it does stop the cheapest version,
 * which is cancelling and restarting on the same account indefinitely.
 *
 * The rest of that defence belongs at the payment provider, which can see the
 * card, and to requiring a payment method before a trial starts. Both are
 * recorded as outstanding rather than assumed.
 */
export function mayStartTrial(
  account: Pick<Account, "trialClaimedAt" | "disabledAt">,
): TrialDecision {
  if (account.disabledAt !== undefined) {
    return { allowed: false, reason: "This account has been disabled." };
  }
  if (account.trialClaimedAt !== undefined) {
    return {
      allowed: false,
      reason: `A trial was already started on ${account.trialClaimedAt.slice(0, 10)}. Trials are one per account.`,
    };
  }
  return { allowed: true, reason: "No trial has been started on this account." };
}

export const ALL_ROLES: readonly Role[] = [
  "admin", "operator", "investor", "funder", "partner", "seller",
];

/**
 * The roles a visitor may give themselves at public sign-up.
 *
 * Everyone signs up to Lode freely and independently and chooses what they do —
 * seller, buyer/investor, estate agent, lender, or a flipper (buyer + seller).
 * This is the normal path, and the lender and agent onboarding here is left
 * exactly as it was. The only role NOT here is staff (`admin`, `operator`): a
 * privilege that reaches seller data or the whole platform is granted by a named
 * administrator, never claimed on a form.
 */
export const SELF_SERVICE_ROLES: readonly Role[] = ["seller", "investor", "funder", "partner"];

/**
 * The roles an ADMIN may not allocate — they come only from a person's own
 * sign-up.
 *
 * An estate agent and a lender are real-world regulated capacities. A person
 * declares themselves one when they sign up through that role's own onboarding;
 * an administrator's generic "make this account anything" power deliberately
 * cannot stamp someone as an agent or a lender, so the status is always
 * authentic to how the person registered rather than something conferred by a
 * toggle. They are freely self-service (above); what they are not is
 * admin-allocatable. An account that already holds one keeps it.
 */
export const RESERVED_ROLES: readonly Role[] = ["funder", "partner"];

/** Whether a role is one an admin may not allocate (it comes from sign-up only). */
export function isReservedRole(role: Role): boolean {
  return RESERVED_ROLES.includes(role);
}

/**
 * The roles an administrator may actually allocate to an account.
 *
 * Everything that is not reserved: seller, buyer/investor, flipper's parts, and
 * the staff roles (which carry their own named-admin check at the call site).
 * This is "make an account be everything he wants, except estate agent and
 * lender", expressed once so the forms and the server agree. The admin tool is
 * for exceptional cases — the normal path is self-service sign-up.
 */
export function adminAllocatableRoles(): readonly Role[] {
  return ALL_ROLES.filter((r) => !isReservedRole(r));
}

/**
 * The most roles one account may hold.
 *
 * One person, one account — and at most this many roles on it. The cap applies
 * wherever roles are set: an admin allocates up to three, and a person's own
 * self-service choices count toward the same three. It stops an account quietly
 * accumulating every capability on the platform.
 */
export const MAX_ACCOUNT_ROLES = 3;

/** Whether a role set is within the per-account cap (de-duplicated). */
export function withinRoleCap(roles: readonly Role[]): boolean {
  return new Set(roles).size <= MAX_ACCOUNT_ROLES;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  operator: "Operator",
  investor: "Investor",
  funder: "Capital provider",
  partner: "Partner (agent or auctioneer)",
  seller: "Seller",
};

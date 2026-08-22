import {
  categoryDefinition,
  UK_INVESTOR_CATEGORISATION,
  type InvestorCategory,
} from "@shared/domain/jurisdictions/uk-financial-promotion";

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
  | "funder";

export type Permission =
  | "manage-accounts"
  /** The pipeline and Deal Room, which carry seller screening answers. */
  | "view-seller-data"
  /** Investment memoranda and deal packs. A financial promotion. */
  | "view-deal-material"
  /** Create and edit Buy Boxes and Funding Boxes. */
  | "manage-mandates"
  | "view-audit-log";

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
    "view-audit-log",
  ],
  operator: ["view-seller-data", "view-deal-material", "manage-mandates"],
  investor: ["view-deal-material"],
  funder: ["view-deal-material"],
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
  readonly role: Role;
  /** scrypt hash and salt. Never the password. */
  readonly passwordHash: string;
  readonly passwordSalt: string;
  readonly createdAt: string;
  /** Set when access is withdrawn. Disabled accounts keep their audit trail. */
  readonly disabledAt?: string;
  readonly certification?: InvestorCertification;
}

/** An account as it may safely be rendered or logged. */
export interface PublicAccount {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
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
    disabled: account.disabledAt !== undefined,
    ...(account.certification !== undefined ? { certification: account.certification } : {}),
  };
}

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
  account: Pick<Account, "role" | "disabledAt" | "certification">,
  permission: Permission,
  now: Date = new Date(),
): AccessDecision {
  if (account.disabledAt !== undefined) {
    return { allowed: false, reason: "This account has been disabled." };
  }

  if (!ROLE_PERMISSIONS[account.role].includes(permission)) {
    return {
      allowed: false,
      reason: `${article(account.role)} ${account.role} account cannot ${PERMISSION_LABELS[permission]}.`,
    };
  }

  const external = account.role === "investor" || account.role === "funder";
  if (permission === "view-deal-material" && external) {
    const status = certificationStatus(account, now);
    if (!status.current) {
      return { allowed: false, reason: status.reason };
    }
    return { allowed: true, reason: status.reason };
  }

  return { allowed: true, reason: `Granted by the ${account.role} role.` };
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "An" : "A";
}

/** What each permission lets somebody do, in a sentence rather than a slug. */
const PERMISSION_LABELS: Record<Permission, string> = {
  "manage-accounts": "manage accounts",
  "view-seller-data": "see seller enquiries, which carry information given to us in confidence",
  "view-deal-material": "be sent deal material",
  "manage-mandates": "create or edit mandates",
  "view-audit-log": "read the audit trail",
};

/** Convenience for the common question, keeping the reason available. */
export function mayReceiveDealMaterial(
  account: Pick<Account, "role" | "disabledAt" | "certification">,
  now: Date = new Date(),
): AccessDecision {
  return can(account, "view-deal-material", now);
}

export const ALL_ROLES: readonly Role[] = ["admin", "operator", "investor", "funder"];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  operator: "Operator",
  investor: "Investor",
  funder: "Capital provider",
};

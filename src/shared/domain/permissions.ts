/**
 * The permissions this business holds, and what each one unlocks.
 *
 * There were two vocabularies for the same idea and they did not meet.
 * `regulatoryRoute.ts` asked about slugs — `credit-broking`,
 * `regulated-mortgage-introductions` — read from `HELD_PERMISSIONS`. `revenue.ts`
 * asked about sentences — "Estate agency AML registration and redress scheme
 * membership" — read from an assumptions object that defaulted to an empty
 * list and was never given anything else. So `HELD_PERMISSIONS` changed which
 * introductions could be made and had no effect whatever on which fees could
 * be charged: the revenue model was permanently switched off by an
 * unreachable default rather than by a decision.
 *
 * One catalogue now, keyed, and read from configuration in one place.
 *
 * **A permission is evidenced, not asserted.** Each entry carries the number
 * the regulator issued, because these gate chargeable income and the difference
 * between "we are AML supervised" and "we are AML supervised, number
 * XAML00000000" is the difference between a statement somebody can check and
 * one they cannot. Same rule the company identity follows, for the same reason:
 * an unevidenced claim in this position is worse than an absent one.
 */

export type PermissionKey =
  | "estate-agency-aml"
  | "redress-scheme"
  | "credit-broking"
  | "regulated-mortgage-introductions"
  | "financial-promotion-approver"
  | "professional-referrals"
  | "professional-indemnity";

export interface PermissionDefinition {
  readonly key: PermissionKey;
  readonly label: string;
  /** Who grants it. */
  readonly regulator: string;
  /** What it makes lawful, in a sentence. */
  readonly authorises: string;
  /** What goes in the evidence field, so the value is checkable. */
  readonly evidenceLabel: string;
  /**
   * True where carrying on the activity without it is an offence rather than
   * merely a breach. These are the ones the preflight will not let past.
   */
  readonly criminal: boolean;
}

export const PERMISSIONS: readonly PermissionDefinition[] = [
  {
    key: "estate-agency-aml",
    label: "Estate agency AML supervision",
    regulator: "HMRC",
    authorises:
      "Introducing sellers to buyers for a fee, and preparing a deal pack for one. Estate agency work in the UK is supervised business.",
    evidenceLabel: "HMRC anti-money-laundering supervision number",
    // Money Laundering Regulations 2017 reg. 86: carrying on business as an
    // estate agent without registration is an offence.
    criminal: true,
  },
  {
    key: "redress-scheme",
    label: "Property redress scheme membership",
    regulator: "The Property Ombudsman or Property Redress Scheme",
    authorises: "Estate agency work, alongside AML supervision. Neither is sufficient alone.",
    evidenceLabel: "Redress scheme and membership number",
    criminal: false,
  },
  {
    key: "professional-indemnity",
    label: "Professional indemnity insurance",
    regulator: "The insurer",
    authorises:
      "Nothing, strictly — it grants no permission. It is here because it is the difference between a claim that ends in a settlement and one that ends the company, and because every redress scheme requires it as a condition of membership. A platform giving a seller costed routes and a buyer an appraisal is giving advice somebody will one day say was wrong.",
    evidenceLabel: "Insurer, policy number and the limit of indemnity",
    criminal: false,
  },
  {
    key: "credit-broking",
    label: "Credit broking",
    regulator: "FCA",
    authorises: "Introducing borrowers to lenders for a fee.",
    evidenceLabel: "FCA firm reference number, or the principal's FRN and your AR number",
    // FSMA s.19, the general prohibition. A fee earned in breach is also
    // unrecoverable under s.26, so this one costs twice.
    criminal: true,
  },
  {
    key: "regulated-mortgage-introductions",
    label: "Regulated mortgage introductions",
    regulator: "FCA",
    authorises:
      "Introducing a borrower where the security includes a dwelling they or a relative occupy.",
    evidenceLabel: "FCA firm reference number with the home finance permission",
    criminal: true,
  },
  {
    key: "financial-promotion-approver",
    label: "Financial promotion approval",
    regulator: "FCA",
    authorises:
      "Communicating or approving an invitation to engage in investment activity. Without it every promotion needs an authorised approver or an exemption.",
    evidenceLabel: "FCA firm reference number with the s.21 approver permission",
    criminal: true,
  },
  {
    key: "professional-referrals",
    label: "Professional referral arrangements",
    regulator: "The professional's own regulator",
    authorises:
      "Taking or paying a referral fee with a regulated professional. Not a permission we hold so much as an arrangement whose disclosure obligations are met.",
    evidenceLabel: "Reference for the recorded arrangement and its disclosure wording",
    criminal: false,
  },
];

export function permissionDefinition(key: PermissionKey): PermissionDefinition {
  const found = PERMISSIONS.find((p) => p.key === key);
  if (found === undefined) throw new Error(`No permission definition for "${key}".`);
  return found;
}

export interface HeldPermission {
  readonly key: PermissionKey;
  /** The registration number or reference the regulator issued. */
  readonly evidence: string;
}

export interface PermissionSet {
  readonly held: readonly HeldPermission[];
  /**
   * Entries that named a permission but gave no evidence for it.
   *
   * Reported rather than silently dropped or silently trusted. Dropping them
   * would make a typo look like a decision not to hold the permission;
   * trusting them would let `HELD_PERMISSIONS=credit-broking` switch on an
   * income stream on the strength of a word.
   */
  readonly unevidenced: readonly PermissionKey[];
  /** Entries that matched no permission in the catalogue. */
  readonly unrecognised: readonly string[];
}

/**
 * Read the permissions from configuration.
 *
 * Format: comma-separated `key:evidence` pairs, for example
 * `estate-agency-aml:XAML00000000,credit-broking:123456`. A bare key with no
 * evidence is recorded as unevidenced and grants nothing.
 */
export function readPermissions(raw: string | undefined): PermissionSet {
  const held: HeldPermission[] = [];
  const unevidenced: PermissionKey[] = [];
  const unrecognised: string[] = [];

  for (const entry of (raw ?? "").split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;

    const separator = trimmed.indexOf(":");
    const key = (separator === -1 ? trimmed : trimmed.slice(0, separator)).trim().toLowerCase();
    const evidence = separator === -1 ? "" : trimmed.slice(separator + 1).trim();

    const definition = PERMISSIONS.find((p) => p.key === key);
    if (definition === undefined) {
      unrecognised.push(trimmed);
      continue;
    }
    if (evidence === "") {
      unevidenced.push(definition.key);
      continue;
    }
    held.push({ key: definition.key, evidence });
  }

  return { held, unevidenced, unrecognised };
}

/** True where this permission is held with evidence. */
export function holds(set: PermissionSet, key: PermissionKey): boolean {
  return set.held.some((h) => h.key === key);
}

/** The keys held, for the engines that only need the answer. */
export function heldKeys(set: PermissionSet): readonly PermissionKey[] {
  return set.held.map((h) => h.key);
}

export const EMPTY_PERMISSIONS: PermissionSet = {
  held: [],
  unevidenced: [],
  unrecognised: [],
};

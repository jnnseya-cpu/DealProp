import type { SourcerCompliance } from "@shared/domain/accounts";
import { sourcerComplianceProblem } from "@shared/domain/fees";
import { resellerCommission, resellerCommissionHeadline } from "@shared/domain/pricing";
import { permissionDefinition, type PermissionKey } from "@shared/domain/permissions";
import type { DealStatus } from "@shared/domain/types";
import { type Money } from "@shared/money";

/**
 * Who may resell a property, and on what terms.
 *
 * A reseller is a sub-agent: they take a property already listed on the
 * marketplace and market it onward to their own buyer for their own fee, and
 * Lode takes a share of that fee (`resellerCommission` in `pricing.ts`). It is
 * the marketplace's sub-agency rung, and in property it is lawful only under
 * two conditions, both decided here so no surface invents its own rule:
 *
 *  1. **The owner has authorised it.** You cannot sub-instruct an agent on a
 *     property the client never authorised to be marketed that way. The owner
 *     grants a general authority — "vetted partners may market this for me" —
 *     through their own capability link, recorded as `ResaleConsent` on the
 *     deal. No consent, no reselling, however compliant the reseller is.
 *  2. **The reseller is their own regulated firm.** Marketing a property for a
 *     fee is estate-agency work the reseller does in their own name, so they
 *     need their own HMRC AML supervision and redress-scheme membership,
 *     recorded and verified — the exact same bar as a flipper assigning a deal
 *     on, reused here via `sourcerComplianceProblem`.
 *
 * What this module never does is hand the reseller the seller's confidential
 * data. A reseller works from the closed-shape opportunity card
 * (`opportunityCard`) like any other marketplace participant; the decision
 * below takes no seller profile and returns none. Pure and framework-free.
 */

/**
 * The owner's recorded authority for the marketplace's vetted partners to
 * market their listing onward. A general authority, not a named instruction —
 * the owner is opting into the reseller network, which is why the disclosure
 * that resellers may market it travels with the consent.
 */
export interface ResaleConsent {
  /** ISO-8601 when the owner granted it. */
  readonly grantedAt: string;
  /** The owner, named as they gave it (or "The owner" where no name is held). */
  readonly grantedBy: string;
}

export interface ResellDecision {
  readonly allowed: boolean;
  /** Always populated. No bare yes or no. */
  readonly reason: string;
  /** Everything standing in the way, worst first. Empty when allowed. */
  readonly blockers: readonly string[];
  /** The cut headline, so a surface never restates the rate. */
  readonly terms: string;
}

export function mayResell(input: {
  /** The reseller's own regulatory standing (AML + redress), as recorded. */
  readonly compliance: SourcerCompliance | undefined;
  /** The owner's authority on this listing, where granted. */
  readonly resaleConsent: ResaleConsent | undefined;
  readonly now?: Date;
}): ResellDecision {
  const now = input.now ?? new Date();
  const terms = resellerCommissionHeadline();
  const blockers: string[] = [];

  if (input.resaleConsent === undefined) {
    blockers.push(
      "The owner has not authorised this listing to be marketed by a partner. " +
        "Reselling needs the owner's recorded consent first — it is their property to instruct on.",
    );
  }

  // The reseller's own AML + redress, recorded and verified. Same bar, and the
  // same checker, as a flipper assigning a deal on.
  const complianceProblem = sourcerComplianceProblem(input.compliance, now);
  if (complianceProblem !== undefined) {
    blockers.push(
      `Your own regulated standing is not in place: ${complianceProblem} ` +
        "Marketing a property for a fee is estate-agency work you do in your own name.",
    );
  }

  if (blockers.length > 0) {
    return { allowed: false, reason: blockers[0] ?? "Reselling is not available.", blockers, terms };
  }
  return {
    allowed: true,
    reason: `You may market this listing. Lode's cut is ${terms}.`,
    blockers: [],
    terms,
  };
}

/**
 * A reseller's engagement on a listing, recorded once they take it on.
 *
 * The reseller agrees their own fee on the onward sale; Lode's cut is a share
 * of that, never of the property price. Recorded on the deal so the cut can be
 * computed and invoiced on completion.
 */
export interface ResaleArrangement {
  readonly resellerAccountId: string;
  readonly resellerName: string;
  /** The reseller's own fee on the onward sale — the base Lode takes a share of. */
  readonly feeAgreed: Money;
  readonly engagedAt: string;
}

/** Lode's cut needs its own supervision, like every other introduction fee. */
const RESELLER_FEE_PERMISSIONS: readonly PermissionKey[] = ["estate-agency-aml"];

export interface ResellerInvoice {
  /** Lode's cut — a share of the reseller's fee. */
  readonly amount: Money;
  /** True where it may be invoiced now. */
  readonly chargeable: boolean;
  /** Everything in the way, worst first. Empty when chargeable. */
  readonly blockers: readonly string[];
  readonly terms: string;
}

/**
 * Lode's cut on a reseller's completed onward sale, and whether it may be
 * raised yet.
 *
 * The same shape as the fee engine's other cuts: a permission Lode must hold,
 * a stage the money is due at (completion, never earlier), and once-only. The
 * amount is `resellerCommission` of the reseller's agreed fee.
 */
export function resellerInvoice(input: {
  readonly arrangement: ResaleArrangement;
  readonly permissionsHeld: readonly PermissionKey[];
  readonly status: DealStatus;
  readonly alreadyRaised?: boolean;
}): ResellerInvoice {
  const amount = resellerCommission(input.arrangement.feeAgreed);
  const blockers: string[] = [];

  for (const key of RESELLER_FEE_PERMISSIONS) {
    if (input.permissionsHeld.includes(key)) continue;
    const permission = permissionDefinition(key);
    blockers.push(
      `${permission.label} is not recorded as held. Obtain it from ${permission.regulator} and record the ${permission.evidenceLabel.toLowerCase()}.`,
    );
  }
  if (input.status !== "completed") {
    blockers.push(
      `The onward sale has not completed (the deal is "${input.status}"). The cut is due on completion and at no earlier point.`,
    );
  }
  if (input.alreadyRaised === true) {
    blockers.push("It has already been raised against this deal.");
  }

  return {
    amount,
    chargeable: blockers.length === 0,
    blockers,
    terms: resellerCommissionHeadline(),
  };
}

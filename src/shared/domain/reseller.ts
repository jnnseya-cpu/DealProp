import type { SourcerCompliance } from "@shared/domain/accounts";
import { sourcerComplianceProblem } from "@shared/domain/fees";
import { resellerCommissionHeadline } from "@shared/domain/pricing";

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

import { add, applyBps, ZERO, type Money } from "@shared/money";
import { gbp } from "@shared/format";
import type { DealAppraisal, DealStatus } from "@shared/domain/types";
import { permissionDefinition, type PermissionKey } from "@shared/domain/permissions";
import { successFee, type SellerService } from "@shared/domain/pricing";
import { DEFAULT_ASSUMPTIONS, type RevenueAssumptions, type RevenueStream } from "@shared/domain/revenue";

/**
 * What may actually be invoiced on this deal, today, and to whom.
 *
 * `dealRevenue()` models the economics of a completed transaction and is
 * rendered on two pages. It is not a billing system and was never called by
 * one: the four transaction streams have always been display-only, so the
 * difference between the permissioned model and the unpermissioned one was a
 * difference in a diagram.
 *
 * This is the missing half. It answers a narrower and more useful question —
 * *can this specific fee be raised right now* — and it answers no far more
 * often than the revenue model does, because a fee needs four things and the
 * money is only one of them:
 *
 *  1. **The permission.** Held, and evidenced. Estate agency work without HMRC
 *     supervision is an offence; a credit-broking fee earned without FCA
 *     authorisation is unrecoverable under FSMA s.26 as well as unlawful, so
 *     that one costs twice.
 *  2. **The stage.** A success fee on a deal that has not completed is not a
 *     fee, it is a hope. Each fee names the stage it becomes due at.
 *  3. **The disclosure.** The Estate Agents Act 1979 s.18 requires the client
 *     to be told the fees before they are bound, and an undisclosed referral
 *     fee is a misleading omission under the CPRs. An undisclosed fee is
 *     therefore not merely rude — it is unenforceable, which makes disclosure
 *     the thing that turns the model into money rather than the thing that
 *     slows it down.
 *  4. **A named person raising it.** Recorded elsewhere; this decides only
 *     whether they may.
 *
 * The fee is computed here and nowhere else, for the same reason the plan price
 * is computed in `pricing.ts` and nowhere else: two places that state an amount
 * eventually disagree, and the customer never loses that argument.
 */

export const FEES_VERSION = "fees-1";

export type FeeKey =
  | "deal-packaging"
  | "deal-success-fee"
  | "seller-success-fee"
  | "funding-introduction";

/**
 * Who is invoiced.
 *
 * The seller *is* a payer, on one fee and one only: a percentage of the price
 * actually achieved, due on completion and on nothing else. This reverses the
 * earlier rule that the seller was supply rather than revenue, and it is a
 * deliberate reversal rather than a drift — "pay only when your property
 * sells" is the proposition, and a proposition with no fee behind it is a
 * marketing line rather than a business.
 *
 * What makes it lawful is not the percentage. It is that the seller signed for
 * it before they were bound, that they were told what it was, and that we
 * refuse to raise it where they are still instructed elsewhere on terms that
 * would make them liable twice for one sale. All three are conditions below,
 * not guidance.
 */
export type FeePayer = "buyer" | "lender" | "seller";

/**
 * What the seller signed, and when.
 *
 * The version is recorded because a fee changed after signature is the old fee.
 * A platform that reprices retrospectively against a signed agreement is not
 * charging a fee, it is varying a contract unilaterally, and the term would not
 * survive the first challenge under the Consumer Rights Act 2015.
 */
export interface SellerAgreement {
  /** ISO-8601. */
  readonly signedAt: string;
  /** The person who signed, named. */
  readonly signedBy: string;
  readonly service: SellerService;
  /** The terms version signed, so a later change cannot be applied backwards. */
  readonly termsVersion: string;
}

/**
 * An estate-agency instruction already running on the property.
 *
 * Sole selling rights and sole agency both make the seller liable to their
 * existing agent on a sale introduced by anybody, and in the case of sole
 * selling rights on a sale introduced by the seller themselves. Taking a fee
 * on top of that is how a seller ends up paying twice for one completion — the
 * single most common complaint against online sale platforms, and one the
 * specification prohibits outright. So it is a blocker, not a warning, and it
 * clears when the instruction is released and the release is recorded.
 */
export type InstructionKind = "sole-selling-rights" | "sole-agency" | "multi-agency" | "none";

export interface AgentInstruction {
  readonly kind: InstructionKind;
  /** The agent instructed, named. */
  readonly agent: string;
  /** ISO-8601 when the instruction ended. Absent while it still binds. */
  readonly releasedAt?: string;
  /** Who recorded the release. */
  readonly releasedBy?: string;
}

/**
 * True where this instruction would still expose the seller to a second fee.
 *
 * Multi-agency is not a blocker: the seller has already accepted that whoever
 * introduces the buyer is paid, and that is the arrangement we are one party
 * to. Sole agency and sole selling rights are, because there the existing
 * agent is paid whether or not they introduced anybody.
 */
export function bindsSellerElsewhere(instruction: AgentInstruction | undefined): boolean {
  if (instruction === undefined) return false;
  if (instruction.releasedAt !== undefined) return false;
  return instruction.kind === "sole-selling-rights" || instruction.kind === "sole-agency";
}

/**
 * What has to have been disclosed, and to whom, before a fee is raised.
 *
 * Recorded against the deal rather than asserted at invoice time, because the
 * disclosure has to happen *before* the client is bound, and a tick box on the
 * invoice screen is by definition after.
 */
export interface FeeDisclosure {
  /** ISO-8601, when the seller was told. */
  readonly at: string;
  /** Who told them. */
  readonly by: string;
  /** The words used, kept verbatim as the evidence. */
  readonly wording: string;
}

export interface FeeDefinition {
  readonly key: FeeKey;
  readonly stream: RevenueStream;
  readonly label: string;
  readonly payer: FeePayer;
  /** How the amount is arrived at, in a sentence a client can check. */
  readonly basis: string;
  readonly requiresPermissions: readonly PermissionKey[];
  /** The earliest stage at which this becomes due. */
  readonly dueAt: readonly DealStatus[];
  /** True where the seller must have been told before it may be raised. */
  readonly requiresSellerDisclosure: boolean;
}

export const FEE_DEFINITIONS: readonly FeeDefinition[] = [
  {
    key: "deal-packaging",
    stream: "deal-packaging",
    label: "Deal packaging",
    payer: "buyer",
    basis: "A fixed fee for preparing the pack, charged whether or not the deal completes.",
    requiresPermissions: ["estate-agency-aml"],
    // Chargeable on a qualified deal, because the work is the pack rather than
    // the completion — which is exactly why it has to be described accurately
    // at the point of sale.
    dueAt: ["qualified", "in-market", "funded", "completed"],
    requiresSellerDisclosure: true,
  },
  {
    key: "deal-success-fee",
    stream: "deal-success-fee",
    label: "Deal success fee",
    payer: "buyer",
    basis: "A percentage of the purchase price, due on completion.",
    requiresPermissions: ["estate-agency-aml", "redress-scheme"],
    dueAt: ["completed"],
    requiresSellerDisclosure: true,
  },
  {
    key: "seller-success-fee",
    stream: "seller-success-fee",
    label: "Seller success fee",
    payer: "seller",
    basis:
      "A percentage of the price achieved, with a floor and a ceiling, due only on completion. Nothing is payable if the property does not sell.",
    requiresPermissions: ["estate-agency-aml", "redress-scheme"],
    dueAt: ["completed"],
    requiresSellerDisclosure: true,
  },
  {
    key: "funding-introduction",
    stream: "funding-introduction",
    label: "Funding introduction",
    payer: "lender",
    basis: "A percentage of the facility drawn, due once the facility completes.",
    requiresPermissions: ["credit-broking"],
    dueAt: ["funded", "completed"],
    // Paid by the lender, so the seller is not a party to it. The borrower's
    // disclosure is handled by the regulatory route, not here.
    requiresSellerDisclosure: false,
  },
];

export function feeDefinition(key: FeeKey): FeeDefinition {
  const found = FEE_DEFINITIONS.find((f) => f.key === key);
  if (found === undefined) throw new Error(`No fee definition for "${key}".`);
  return found;
}

export interface FeeBlocker {
  readonly reason: string;
  /** What would clear it. */
  readonly remedy: string;
}

export interface ChargeableFee {
  readonly definition: FeeDefinition;
  readonly amount: Money;
  /** True where every condition is met and this may be invoiced now. */
  readonly chargeable: boolean;
  /** Everything standing in the way, worst first. Empty when chargeable. */
  readonly blockers: readonly FeeBlocker[];
  /** True where it has already been raised. */
  readonly alreadyRaised: boolean;
  readonly version: string;
}

/** Everything an amount can depend on. `FeeContext` satisfies it structurally. */
export interface FeeAmountContext {
  readonly appraisal: DealAppraisal;
  readonly assumptions?: RevenueAssumptions;
  readonly sellerAgreement?: SellerAgreement;
}

export interface FeeContext extends FeeAmountContext {
  readonly status: DealStatus;
  readonly permissionsHeld: readonly PermissionKey[];
  readonly disclosure?: FeeDisclosure;
  /** Fee keys already raised against this deal. */
  readonly raised: readonly FeeKey[];
  /** An estate-agency instruction already running on the property, if any. */
  readonly existingInstruction?: AgentInstruction;
}

/**
 * The amount, computed here and nowhere else.
 *
 * The seller fee is quoted against the signed service where there is one and
 * against the standard band where there is not, so a page can show what it
 * *would* be before anything is signed — while `chargeableFees()` still refuses
 * to raise it. Quoting and charging are different questions and only one of
 * them needs a signature.
 */
export function feeAmount(key: FeeKey, context: FeeAmountContext): Money {
  const assumptions = context.assumptions ?? DEFAULT_ASSUMPTIONS;
  switch (key) {
    case "deal-packaging":
      return assumptions.packagingFee;
    case "deal-success-fee":
      return applyBps(context.appraisal.inputs.purchasePrice, assumptions.successFeeBps);
    case "seller-success-fee":
      return successFee(
        context.appraisal.inputs.purchasePrice,
        context.sellerAgreement?.service ?? "standard",
      );
    case "funding-introduction":
      return applyBps(context.appraisal.funding.seniorDebt, assumptions.fundingIntroBps);
  }
}

export function chargeableFees(context: FeeContext): readonly ChargeableFee[] {
  return FEE_DEFINITIONS.map((definition): ChargeableFee => {
    const amount = feeAmount(definition.key, context);
    const blockers: FeeBlocker[] = [];
    const alreadyRaised = context.raised.includes(definition.key);

    for (const key of definition.requiresPermissions) {
      if (context.permissionsHeld.includes(key)) continue;
      const permission = permissionDefinition(key);
      blockers.push({
        reason: `${permission.label} is not recorded as held.`,
        remedy: `Obtain it from ${permission.regulator} and record the ${permission.evidenceLabel.toLowerCase()}.${
          permission.criminal ? " Carrying on this activity without it is an offence." : ""
        }`,
      });
    }

    if (!definition.dueAt.includes(context.status)) {
      blockers.push({
        reason: `This deal is "${context.status}" and the fee falls due at ${definition.dueAt.join(" or ")}.`,
        remedy: "Raise it when the deal reaches that stage. Invoicing earlier is invoicing for work not yet done.",
      });
    }

    if (definition.payer === "seller") {
      if (context.sellerAgreement === undefined) {
        blockers.push({
          reason: "The seller has not signed an agreement.",
          remedy:
            "Have the seller sign the terms, and record who signed and which version. A percentage nobody agreed to is not a fee.",
        });
      }
      if (bindsSellerElsewhere(context.existingInstruction)) {
        const instruction = context.existingInstruction;
        blockers.push({
          reason: `The seller is still instructed to ${instruction?.agent ?? "another agent"} under ${
            instruction?.kind === "sole-selling-rights" ? "sole selling rights" : "sole agency"
          }.`,
          remedy:
            "Obtain and record the release before raising anything. Under that instruction the existing agent is paid on a sale whoever introduced the buyer, so a fee on top of it makes the seller pay twice for one completion.",
        });
      }
    }

    if (definition.requiresSellerDisclosure && context.disclosure === undefined) {
      blockers.push({
        reason: "The seller has not been told about this fee.",
        remedy:
          "Record the disclosure, with the wording and who gave it. The Estate Agents Act 1979 s.18 requires the client to be told before they are bound, and a fee they were not told about is unenforceable — so this is what makes the fee collectable, not what delays it.",
      });
    }

    if (alreadyRaised) {
      blockers.push({
        reason: "It has already been raised against this deal.",
        remedy: "Nothing. A fee is raised once; a second one would be a second invoice for the same work.",
      });
    }

    return {
      definition,
      amount,
      chargeable: blockers.length === 0,
      blockers,
      alreadyRaised,
      version: FEES_VERSION,
    };
  });
}

export interface FeePosition {
  readonly fees: readonly ChargeableFee[];
  /** What may be invoiced right now. */
  readonly chargeableNow: Money;
  /** What is modelled but blocked. */
  readonly blocked: Money;
  /** Already raised. */
  readonly raised: Money;
  readonly summary: string;
}

export function feePosition(context: FeeContext): FeePosition {
  const fees = chargeableFees(context);

  const chargeableNow = add(...fees.filter((f) => f.chargeable).map((f) => f.amount), ZERO);
  const raised = add(...fees.filter((f) => f.alreadyRaised).map((f) => f.amount), ZERO);
  const blocked = add(
    ...fees.filter((f) => !f.chargeable && !f.alreadyRaised).map((f) => f.amount),
    ZERO,
  );

  return { fees, chargeableNow, blocked, raised, summary: summarise(chargeableNow, blocked, raised) };
}

function summarise(chargeableNow: Money, blocked: Money, raised: Money): string {
  if (chargeableNow <= ZERO && blocked <= ZERO && raised <= ZERO) {
    return "Nothing is chargeable on this deal and nothing is modelled against it.";
  }
  if (chargeableNow <= ZERO && raised > ZERO && blocked <= ZERO) {
    return `${gbp(raised)} has been raised on this deal and there is nothing further to charge.`;
  }
  if (chargeableNow <= ZERO) {
    return `Nothing may be invoiced on this deal yet. ${gbp(blocked)} is modelled against it and every part of it is waiting on something — the reasons are against each fee.`;
  }
  return `${gbp(chargeableNow)} may be invoiced now${blocked > ZERO ? `, with ${gbp(blocked)} still blocked` : ""}${raised > ZERO ? `, and ${gbp(raised)} already raised` : ""}.`;
}

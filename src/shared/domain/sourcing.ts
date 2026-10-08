import type { CitationKey } from "@shared/domain/citations";
import type { PermissionKey } from "@shared/domain/permissions";

/**
 * Deal sourcing: getting paid for a deal you never own.
 *
 * This is the thing the UK market calls deal sourcing or deal packaging, and
 * it is the model this platform actually operates. Nobody here buys the
 * property. A deal is found, negotiated and passed to an investor, and the
 * payment is for the finding and the structuring.
 *
 * It is lawful. Most of the people doing it are doing it unlawfully, and the
 * reason is almost always one of two things, both of which this module
 * refuses structurally rather than warns about:
 *
 *  1. **"I act for the buyer, so the Estate Agents Act does not apply."** It
 *     does. Section 1 covers things done on instructions from a client who
 *     wishes to dispose of *or to acquire* an interest in land. Sourcing for
 *     an investor is estate agency work, which means HMRC anti-money-
 *     laundering registration and redress-scheme membership, and carrying on
 *     the business without the first is a criminal offence rather than a
 *     paperwork failure.
 *
 *  2. **Taking the fee before completion.** A fee taken from an investor for a
 *     deal that then does not happen is where this sector's complaints, and
 *     its prosecutions, live. Every route here is due on completion and on
 *     nothing else, and the type system has no value for "on exchange".
 *
 * What this module is not: a tax computation. The stamp duty treatment of an
 * assignment or a sub-sale lives in Schedule 2A of the Finance Act 2003, the
 * relief has to be claimed rather than assumed, and HMRC has successfully
 * attacked arrangements that looked exactly like the honest ones. So the
 * engine does not compute it. It records that a named conveyancer confirmed
 * the position in writing, or it routes the deal to review — which is the same
 * direction every uncertainty takes in `regulatoryRoute.ts`, and for the same
 * reason.
 */

export const SOURCING_RULES = {
  asOf: "2026-10-08",
  jurisdiction: "GB",
  /**
   * True until counsel has approved this for production.
   *
   * Deliberately starts true, like the finance routing rules. Nothing here has
   * been through legal review, and the pre-completion stamp duty rules in
   * particular are contested enough that a module presenting itself as settled
   * would be worse than one that says plainly it is not.
   */
  requiresCounselApproval: true,
  citation:
    "Estate Agents Act 1979 s.1 and s.18; Money Laundering Regulations 2017; Finance Act 2003 Sch. 2A; Digital Markets, Competition and Consumers Act 2024 Part 4",
} as const;

/**
 * The routes by which a deal reaches an investor without us ever owning it.
 *
 * A closed set. A fourth route was described to us and the description was
 * truncated before it arrived, so it is deliberately absent rather than
 * guessed at — an invented route in a register like this would be worse than a
 * missing one, because the register is what the fee engine and the operator
 * surface read. Adding it is one entry in `SOURCING_ROUTES` and one member
 * here.
 */
export type SourcingRoute =
  /** Find and negotiate; the investor buys directly from the seller. */
  | "sourcing-fee"
  /** Contract with the seller, then assign that position before completion. */
  | "assignment"
  /** Exchange with the seller and with the buyer; both complete the same day. */
  | "back-to-back";

/** Whose instructions we are acting on. It is never nobody. */
export type SourcingClient = "seller" | "investor" | "both";

export interface SourcingRouteDefinition {
  readonly route: SourcingRoute;
  readonly label: string;
  /** What actually happens, in one sentence a seller could follow. */
  readonly whatHappens: string;
  readonly client: SourcingClient;
  /**
   * Whether we are ever the owner. False on every route, which is the whole
   * category — and the reason the transfer-tax question is difficult rather
   * than absent.
   */
  readonly weOwnIt: false;
  /**
   * What makes this lawful for us to do at all.
   *
   * Identical on all three, and that is the point rather than an oversight:
   * each one is an introduction between a seller and a buyer for a fee, which
   * is estate agency work however the paperwork is arranged.
   */
  readonly requiresPermissions: readonly PermissionKey[];
  readonly feeBasis: string;
  /** Who is invoiced. The seller is never invoiced for a sourcing fee. */
  readonly paidBy: "investor";
  /** The only value there is. A fee on exchange is not expressible here. */
  readonly dueOn: "completion";
  readonly transferTax: string;
  /**
   * True where the stamp duty position must be confirmed in writing by a named
   * conveyancer before the route may be used.
   */
  readonly needsConveyancerConfirmation: boolean;
  readonly contractRequirements: readonly string[];
  /** The way this route goes wrong, stated as the consequence. */
  readonly principalRisk: string;
  readonly citations: readonly CitationKey[];
}

/** Estate agency work is estate agency work. Same two on every route. */
const ESTATE_AGENCY: readonly PermissionKey[] = ["estate-agency-aml", "redress-scheme"];

export const SOURCING_ROUTES: readonly SourcingRouteDefinition[] = [
  {
    route: "sourcing-fee",
    label: "Sourcing for a fee",
    whatHappens:
      "We find the property, agree the terms, and the investor buys it directly from the seller. There is one sale and we are not a party to it.",
    client: "both",
    weOwnIt: false,
    requiresPermissions: ESTATE_AGENCY,
    feeBasis:
      "A fixed fee, or a percentage of the purchase price, invoiced to the investor on completion.",
    paidBy: "investor",
    dueOn: "completion",
    transferTax:
      "Ordinary. The investor pays on what they pay the seller; there is no second transaction and no relief to claim. Whether our fee forms part of the chargeable consideration depends on what it is for and who it is paid by, which is a question for their conveyancer.",
    // The simplest route is the only one where the engine does not insist,
    // because there is no pre-completion transaction to get wrong.
    needsConveyancerConfirmation: false,
    contractRequirements: [
      "A written agreement with the investor stating the fee, how it is calculated and that it falls due only on completion.",
      "Written disclosure to the seller, before they are bound, that we are paid by the buyer and how much.",
    ],
    principalRisk:
      "The investor completes and declines to pay. The fee is only as good as the agreement behind it, which is why it is in writing before the introduction rather than after it.",
    citations: ["estate-agents-act-s1", "estate-agents-act-s18", "money-laundering-regs", "dmcc-act"],
  },
  {
    route: "assignment",
    label: "Assignment of contract",
    whatHappens:
      "We contract to buy the property, with the seller's agreement that our position may be transferred, and then assign that position to an investor before completion. The investor completes in our place.",
    client: "seller",
    weOwnIt: false,
    requiresPermissions: ESTATE_AGENCY,
    feeBasis: "An assignment fee paid by the investor when they take the contract on.",
    paidBy: "investor",
    dueOn: "completion",
    transferTax:
      "A pre-completion transaction under Schedule 2A of the Finance Act 2003. The investor's chargeable consideration is what they pay the seller plus the assignment fee. We are treated as having made a notional land transaction and must claim relief in a return rather than simply not filing one.",
    needsConveyancerConfirmation: true,
    contractRequirements: [
      "The contract with the seller must permit assignment. Most standard contracts prohibit it, and assigning one that does is a breach rather than a transfer.",
      "The seller must be told that the person completing may not be us, before they are bound.",
      "A named conveyancer's written confirmation of the stamp duty position and of who files what.",
      "An investor whose funds are evidenced before we exchange with the seller.",
    ],
    principalRisk:
      "If the assignment fails after we have exchanged, we are contractually bound to complete on a property we never intended to buy and may be unable to fund. That is the risk, and no amount of fee covers it.",
    citations: ["estate-agents-act-s1", "finance-act-2003", "money-laundering-regs", "dmcc-act"],
  },
  {
    route: "back-to-back",
    label: "Back-to-back sub-sale",
    whatHappens:
      "We exchange with the seller at one price and with the investor at a higher one, and both contracts complete on the same day. The property passes through our hands without us funding it.",
    client: "both",
    weOwnIt: false,
    requiresPermissions: ESTATE_AGENCY,
    feeBasis:
      "The difference between the two prices, realised on the day both contracts complete.",
    paidBy: "investor",
    dueOn: "completion",
    transferTax:
      "A pre-completion transaction under Schedule 2A of the Finance Act 2003. Correctly structured, the middle party claims relief on the notional transaction so there is no charge on a property never kept — but the relief must be claimed, it is restricted where the arrangements are for avoidance, and HMRC has successfully challenged structures that resembled the compliant ones.",
    needsConveyancerConfirmation: true,
    contractRequirements: [
      "The two contracts must mirror each other on completion date, conditions and title. Any gap between them is a gap we are standing in.",
      "Simultaneous completion, documented as such, with both conveyancers aware of the other contract.",
      "A named conveyancer's written confirmation of the stamp duty position and of the relief being claimed.",
      "An investor whose funds are evidenced before we exchange with the seller.",
      "A decision, recorded, on whether the uplift is disclosed to the seller.",
    ],
    principalRisk:
      "If the onward contract fails on the day, we are obliged to complete the first one with no funding and no buyer. The two contracts mirroring each other is what prevents it, and a difference as small as a completion date does not.",
    citations: ["estate-agents-act-s1", "finance-act-2003", "money-laundering-regs", "dmcc-act"],
  },
];

export function sourcingRoute(route: SourcingRoute): SourcingRouteDefinition {
  const found = SOURCING_ROUTES.find((r) => r.route === route);
  if (found === undefined) throw new Error(`No sourcing route recorded for "${route}".`);
  return found;
}

/* ------------------------------------------------------------ the decision */

/**
 * A conveyancer's written confirmation of the tax position.
 *
 * A name, a firm and a date, on the same principle as every other piece of
 * evidence on this platform: a boolean anybody can set is a claim, not a
 * confirmation. "Our solicitor says it's fine" is not a record.
 */
export interface ConveyancerConfirmation {
  readonly firm: string;
  readonly solicitor: string;
  /** ISO-8601. */
  readonly at: string;
  /** What they actually confirmed, in their words. */
  readonly confirms: string;
}

export interface SourcingFacts {
  readonly route: SourcingRoute;
  /** Permissions recorded as held, with evidence. */
  readonly permissionsHeld: readonly PermissionKey[];
  /** True where the seller is an individual rather than a business. */
  readonly sellerIsConsumer: boolean;
  /**
   * True where the seller has been told in writing, before being bound, that
   * we are paid by the buyer and how much.
   */
  readonly conflictDisclosedToSeller: boolean;
  /** True where the investor's funds have been evidenced, not asserted. */
  readonly investorFundsEvidenced: boolean;
  readonly conveyancer?: ConveyancerConfirmation;
  /**
   * True where any part of the fee has been, or would be, taken before
   * completion. The answer must be no.
   */
  readonly feeTakenBeforeCompletion: boolean;
  /** Only meaningful on back-to-back. Undefined elsewhere. */
  readonly upliftDisclosedToSeller?: boolean;
}

export type SourcingRuling =
  /** Everything needed is recorded. The route may be used. */
  | "PERMITTED"
  /** Nothing unlawful, but a person must decide before it proceeds. */
  | "REVIEW"
  /** It may not proceed on these facts. */
  | "REFUSED";

export interface SourcingBlocker {
  readonly reason: string;
  /** What would clear it. Never "obtain advice" on its own. */
  readonly remedy: string;
}

export interface SourcingDecision {
  readonly route: SourcingRouteDefinition;
  readonly ruling: SourcingRuling;
  /** Why it is refused, worst first. Empty unless REFUSED. */
  readonly blockers: readonly SourcingBlocker[];
  /** Why a person must look. Empty unless REVIEW. */
  readonly reviews: readonly SourcingBlocker[];
  readonly summary: string;
}

/**
 * Whether this route may be used on these facts.
 *
 * The order matters and is deliberate. Permission first, because without it
 * the activity is an offence and nothing else is worth evaluating. Then the
 * fee timing, because that is the one that turns a lawful business into a
 * complaint. Then the things that need a person.
 */
export function routeSourcing(facts: SourcingFacts): SourcingDecision {
  const route = sourcingRoute(facts.route);
  const blockers: SourcingBlocker[] = [];
  const reviews: SourcingBlocker[] = [];

  for (const permission of route.requiresPermissions) {
    if (facts.permissionsHeld.includes(permission)) continue;
    blockers.push({
      reason: `${permission} is not recorded as held, and this is estate agency work.`,
      remedy:
        "Register with HMRC for anti-money-laundering supervision and join a redress scheme, then record both as evidenced. Acting for the investor rather than the seller does not take this outside the Estate Agents Act — s.1 covers instructions from a client who wishes to acquire as well as one who wishes to dispose.",
    });
  }

  if (facts.feeTakenBeforeCompletion) {
    blockers.push({
      reason: "Part of the fee would be taken before completion.",
      remedy:
        "Make the whole fee due on completion. Money taken from an investor for a deal that then does not happen is the single most common cause of complaint and prosecution in this sector, and there is no version of it this platform will record.",
    });
  }

  if (facts.sellerIsConsumer && !facts.conflictDisclosedToSeller) {
    blockers.push({
      reason:
        "The seller is a consumer and has not been told in writing that we are paid by the buyer.",
      remedy:
        "Disclose the fee and who pays it, in writing, before the seller is bound. A fee the client was not told about is unenforceable without a court's permission under s.18, and the omission is a misleading omission in its own right.",
    });
  }

  if (route.needsConveyancerConfirmation && facts.conveyancer === undefined) {
    blockers.push({
      reason: "No conveyancer has confirmed the stamp duty position in writing.",
      remedy:
        "Obtain and record a named solicitor's written confirmation of the Schedule 2A treatment and of who files which return. This engine does not compute pre-completion stamp duty and will not: the relief must be claimed rather than assumed, and it is restricted where the arrangements are for avoidance.",
    });
  }

  if (route.route !== "sourcing-fee" && !facts.investorFundsEvidenced) {
    blockers.push({
      reason: "The investor's funds have not been evidenced, and this route exchanges first.",
      remedy:
        "Evidence the funds before exchanging with the seller. If the onward side fails after exchange, we are obliged to complete on a property we cannot fund — which is the risk this route carries and the one a fee does not cover.",
    });
  }

  if (route.route === "back-to-back" && facts.upliftDisclosedToSeller !== true) {
    reviews.push({
      reason:
        "The seller has not been told that the property is being sold on the same day at a higher price.",
      remedy:
        "Decide, and record the decision with its reasoning. Whether disclosure is legally required turns on the relationship with the seller and is genuinely arguable; whether an undisclosed uplift on a consumer seller survives contact with a redress scheme is much less arguable. A person decides this, not a rule.",
    });
  }

  if (SOURCING_RULES.requiresCounselApproval) {
    reviews.push({
      reason: "These routing rules have not been approved by counsel.",
      remedy:
        "Have a solicitor review the rule set and clear it for production, then set requiresCounselApproval to false with the date and the firm recorded.",
    });
  }

  const ruling: SourcingRuling =
    blockers.length > 0 ? "REFUSED" : reviews.length > 0 ? "REVIEW" : "PERMITTED";

  return {
    route,
    ruling,
    blockers,
    reviews,
    summary:
      ruling === "REFUSED"
        ? `${route.label} may not proceed: ${blockers.length} blocker${blockers.length === 1 ? "" : "s"}.`
        : ruling === "REVIEW"
          ? `${route.label} is available once a person decides ${reviews.length} open question${reviews.length === 1 ? "" : "s"}.`
          : `${route.label} may proceed. Everything it requires is recorded.`,
  };
}

/** Every route ruled on the same facts, so an operator sees what is open. */
export function routeAllSourcing(
  facts: Omit<SourcingFacts, "route">,
): readonly SourcingDecision[] {
  return SOURCING_ROUTES.map((definition) => routeSourcing({ ...facts, route: definition.route }));
}

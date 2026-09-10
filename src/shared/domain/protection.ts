import { ratioBps, sub } from "@shared/money";
import type { DealInputs } from "@shared/domain/types";
import { diagnoseSeller, type SellerDiagnostics } from "@shared/domain/motivation";

/**
 * Seller Protection Engine.
 *
 * This module is the reason the platform can defend its business model. The
 * commercial temptation in motivated-seller acquisition is to convert distress
 * into discount; the regulatory and reputational reality is that doing so
 * produces unenforceable contracts, complaints and enforcement action.
 *
 * So protection is not advisory here. A `block` outcome stops the deal from
 * reaching capital at all, and the engine is invoked by the Deal Director
 * before any structure is shown to a seller or any pack is sent to a funder.
 */

export type ProtectionSeverity = "info" | "caution" | "block";

/**
 * Who a flag is about, and therefore whether it may ever be published.
 *
 * A required field rather than a lookup somewhere else, because the decision
 * belongs next to the flag that needs it. "Discount exceeds review threshold"
 * is a fact about a transaction and could be printed in a newspaper. "Possible
 * capacity concern reported" is a fact about a person, it is health data, and
 * publishing it is a §20 prohibition and very probably an Article 9 breach.
 *
 * The blog agent published every flag verbatim on a public page for a named
 * locality, including that one. Nothing in the type system stopped it, which
 * is why this is a field the compiler insists on rather than a convention.
 */
export type FlagSubject =
  /** About the deal: price, evidence, structure. Publishable. */
  | "transaction"
  /** About the seller as a person. Never leaves an authenticated surface. */
  | "seller";

export interface ProtectionFlag {
  readonly key: string;
  readonly severity: ProtectionSeverity;
  readonly subject: FlagSubject;
  readonly label: string;
  readonly detail: string;
  /** What must happen before the deal may proceed. */
  readonly remedy: string;
}

/**
 * What may be said about a protection outcome in public.
 *
 * The blog agent published every flag's label on a public page, for a named
 * locality, including "possible capacity concern reported" and "elderly seller
 * combined with a substantial discount". Both are facts about a person, the
 * first is health data, and §20's prohibition on publishing a seller's
 * circumstances exists precisely for them.
 *
 * The fix is not to remember not to. It is that there is one function that
 * produces publishable text about a block, it returns the transaction-subject
 * flags and a count of the rest, and the flags themselves are never reachable
 * from a public surface. A count is honest — it says something was found and
 * refuses to say what — and it is the most that can be said without turning a
 * safeguard into a disclosure.
 */
export interface PublicProtectionSummary {
  readonly blocked: boolean;
  /** Flags about the transaction. Safe to print anywhere. */
  readonly publishable: readonly ProtectionFlag[];
  /** How many were about the seller as a person, and are therefore withheld. */
  readonly withheld: number;
  /** A sentence that says what happened without saying it about anybody. */
  readonly summary: string;
}

export function publicProtectionSummary(outcome: ProtectionOutcome): PublicProtectionSummary {
  const publishable = outcome.flags.filter((f) => f.subject === "transaction");
  const withheld = outcome.flags.length - publishable.length;

  const withheldSentence =
    withheld === 0
      ? ""
      : ` ${withheld} further safeguard${withheld === 1 ? "" : "s"} concerned the seller's own circumstances and ${withheld === 1 ? "is" : "are"} not published — the checks exist to protect that person, and describing them here would be the opposite of protecting them.`;

  return {
    blocked: outcome.blocked,
    publishable,
    withheld,
    summary: outcome.blocked
      ? `Seller Protection blocked this deal, which caps the Deal Score at 35 and forces a rejection whatever the margin says.${withheldSentence}`
      : outcome.flags.length === 0
        ? "Seller Protection raised nothing on this deal."
        : `Seller Protection raised ${outcome.flags.length} flag${outcome.flags.length === 1 ? "" : "s"} without blocking.${withheldSentence}`,
  };
}

export interface ProtectionOutcome {
  readonly flags: readonly ProtectionFlag[];
  /** True where the deal cannot proceed until flags are cleared. */
  readonly blocked: boolean;
  /** True where a human reviewer must sign off before capital sees the deal. */
  readonly requiresHumanReview: boolean;
  /** Disclosures that must be shown to the seller before they can accept. */
  readonly requiredDisclosures: readonly string[];
}

/** Discount beyond which a consumer sale attracts mandatory extra scrutiny. */
const HIGH_DISCOUNT_BPS = 2_500;
/** Discount beyond which the deal is blocked pending human review. */
const EXTREME_DISCOUNT_BPS = 3_500;

export function assessSellerProtection(
  inputs: DealInputs,
  diagnostics?: SellerDiagnostics,
): ProtectionOutcome {
  const diag = diagnostics ?? diagnoseSeller(inputs.seller, inputs.property);
  const flags: ProtectionFlag[] = [];
  const disclosures: string[] = [];

  const discountBps = ratioBps(
    sub(inputs.property.openMarketValue, inputs.purchasePrice),
    inputs.property.openMarketValue,
  );

  const screening = inputs.seller.screening ?? {};

  // --- Discount severity -------------------------------------------------
  if (discountBps >= EXTREME_DISCOUNT_BPS) {
    flags.push({
      key: "extreme-discount",
      subject: "transaction",
      severity: "block",
      label: "Discount exceeds review threshold",
      detail: `The modelled price is ${(discountBps / 100).toFixed(1)}% below the estimated open market value. A discount of this size against a consumer seller requires human review before it may be offered.`,
      remedy: "Human reviewer must confirm the valuation evidence and the seller's informed consent.",
    });
  } else if (discountBps >= HIGH_DISCOUNT_BPS) {
    flags.push({
      key: "high-discount",
      subject: "transaction",
      severity: "caution",
      label: "Substantial discount to market value",
      detail: `The modelled price is ${(discountBps / 100).toFixed(1)}% below estimated open market value.`,
      remedy: "Seller must be shown the market valuation and the buyer's projected profit before accepting.",
    });
  }

  // --- Vulnerability indicators -----------------------------------------
  if (diag.vulnerabilitySignal) {
    flags.push({
      key: "situation-vulnerability",
      subject: "seller",
      severity: "caution",
      label: `Situation carries a vulnerability indicator: ${diag.situationLabel}`,
      detail:
        "This category of seller situation is associated with financial or emotional pressure that can impair decision-making.",
      remedy: "Independent legal advice must be evidenced before contracts are issued.",
    });
  }

  if (screening.reportsHealthOrCapacityConcern === true) {
    flags.push({
      key: "capacity-concern",
      subject: "seller",
      severity: "block",
      label: "Possible capacity concern reported",
      detail:
        "The seller or their representative has reported a health or capacity concern. Contractual capacity cannot be assumed.",
      remedy: "Do not proceed without confirmation of capacity and independent legal representation.",
    });
  }

  if (screening.ageBand === "80-plus" && discountBps >= HIGH_DISCOUNT_BPS) {
    flags.push({
      key: "age-and-discount",
      subject: "seller",
      severity: "block",
      label: "Elderly seller combined with a substantial discount",
      detail:
        "A large discount agreed by a seller aged 80 or over is a recognised indicator of potential financial abuse.",
      remedy: "Human review plus evidenced independent legal advice and, where appropriate, family or advocate involvement.",
    });
  }

  if (screening.isUnderTimePressureFromThirdParty === true) {
    flags.push({
      key: "third-party-pressure",
      subject: "seller",
      severity: "block",
      label: "Third-party pressure reported",
      detail:
        "The seller reports being pressed to transact by someone other than themselves. This is a coercion indicator.",
      remedy: "Human review required. The pressuring party must not be present for seller communications.",
    });
  }

  if (screening.isSoleDecisionMaker === false) {
    flags.push({
      key: "multiple-owners",
      subject: "seller",
      severity: "caution",
      label: "Seller is not the sole decision maker",
      detail: "All legal owners must consent. Proceeding without them risks an unenforceable contract.",
      remedy: "Obtain confirmation of authority to sell from every registered proprietor.",
    });
  }

  if (screening.reportsFinancialDistress === true && discountBps >= HIGH_DISCOUNT_BPS) {
    flags.push({
      key: "distress-and-discount",
      subject: "seller",
      severity: "caution",
      label: "Financial distress combined with a substantial discount",
      detail:
        "Sellers in acute financial distress may accept terms they would otherwise refuse.",
      remedy: "Signpost free debt advice and evidence a cooling-off period before exchange.",
    });
  }

  // --- Missing safeguards ------------------------------------------------
  if (screening.hasIndependentLegalAdvice !== true) {
    flags.push({
      key: "no-independent-advice",
      subject: "transaction",
      severity: discountBps >= HIGH_DISCOUNT_BPS ? "block" : "caution",
      label: "Independent legal advice not evidenced",
      detail:
        "The seller has not confirmed they are taking independent legal advice on the proposed structure.",
      remedy: "Evidence independent legal advice before the seller signs anything.",
    });
  }

  if (screening.hasReceivedIndependentValuation !== true && discountBps >= HIGH_DISCOUNT_BPS) {
    flags.push({
      key: "no-independent-valuation",
      subject: "transaction",
      severity: "caution",
      label: "No independent valuation evidenced",
      detail:
        "The seller is being asked to accept a discount against a valuation they have not independently verified.",
      remedy: "Offer and evidence an independent valuation at the platform's cost.",
    });
  }

  // --- Structure-specific protections -----------------------------------
  const creativeStructures = new Set([
    "seller-finance",
    "lease-option",
    "option-agreement",
    "deferred-consideration",
    "assisted-sale",
  ]);
  if (creativeStructures.has(inputs.structure)) {
    flags.push({
      key: "creative-structure",
      subject: "transaction",
      severity: "caution",
      label: "Non-standard structure proposed",
      detail:
        "The seller is being offered something other than an ordinary sale. Deferred or contingent consideration transfers risk to the seller that a conventional sale would not.",
      remedy: "Seller must receive a written plain-language explanation of what they receive, when, and what happens if the buyer defaults.",
    });
    disclosures.push(
      "What you will be paid, when each payment is due, and what security you hold if the buyer fails to pay.",
    );
    disclosures.push(
      "What happens to your property and your money if the buyer becomes insolvent before completing.",
    );
  }

  // --- Universal disclosures --------------------------------------------
  disclosures.push(
    "The estimated open market value of your property, and how that estimate was reached.",
  );
  disclosures.push(
    "The buyer's projected profit on this transaction, and how the platform is paid.",
  );
  disclosures.push(
    "That you are entitled to seek independent legal and financial advice before accepting, and to sell on the open market instead.",
  );

  const blocked = flags.some((f) => f.severity === "block");
  const requiresHumanReview = blocked || flags.filter((f) => f.severity === "caution").length >= 3;

  return {
    flags,
    blocked,
    requiresHumanReview,
    requiredDisclosures: disclosures,
  };
}

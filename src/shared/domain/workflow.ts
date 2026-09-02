import type { DealStatus } from "@shared/domain/types";

/**
 * Where a transaction has actually got to.
 *
 * Twelve steps from a property being noticed to it sitting in a buyer's
 * portfolio. The value is not the diagram — anybody can draw one — it is that
 * each step is *derived from what is recorded* rather than set by somebody
 * clicking "next". A stage field that a person advances tells you what they
 * believe; this tells you what can be proved, and the two diverge precisely
 * when it matters.
 *
 * Two consequences worth stating.
 *
 * The steps are ordered and the deal is at the last one whose evidence
 * exists — not at the furthest one anybody has touched. A deal with an offer
 * accepted but no seller checks recorded is not at "offer accepted"; it is
 * stuck at the check, and saying otherwise is how a transaction reaches
 * exchange with a hole in it.
 *
 * The last step is not built. `portfolio` is in the list because the
 * specification ends there and leaving it out would misrepresent the shape of
 * the product, but it is marked `built: false` and the page says so. A step
 * drawn as though it works is worse than a step drawn as missing.
 */

export const WORKFLOW_VERSION = "workflow-1";

export type StageKey =
  | "discovered"
  | "authority-verified"
  | "opportunity-protected"
  | "buyers-matched"
  | "reveal-purchased"
  | "appraised"
  | "negotiating"
  | "offer-accepted"
  | "professionals-appointed"
  | "progressing"
  | "completed"
  | "portfolio";

export interface StageDefinition {
  readonly key: StageKey;
  readonly label: string;
  /** What happens here. */
  readonly what: string;
  /** What has to be recorded for the deal to have reached it. */
  readonly evidencedBy: string;
  /** False where this step of the specification is not implemented. */
  readonly built: boolean;
}

export const STAGES: readonly StageDefinition[] = [
  {
    key: "discovered",
    label: "Discovered or received",
    what: "A property arrives — from a licensed source, from a seller telling us their situation, or from an agent.",
    evidencedBy: "The deal exists.",
    built: true,
  },
  {
    key: "authority-verified",
    label: "Authority verified",
    what: "Somebody with authority over the property confirms it is for sale, and we check who they are and whether they may sell it.",
    evidencedBy: "A sale confirmation recorded, and the seller's due diligence complete.",
    built: true,
  },
  {
    key: "opportunity-protected",
    label: "Protected opportunity created",
    what: "Seller Protection runs, material information is answered, and the opportunity becomes something that may lawfully be marketed.",
    evidencedBy: "Part A answered and Seller Protection not blocking.",
    built: true,
  },
  {
    key: "buyers-matched",
    label: "Qualified buyers matched",
    what: "Buy Boxes are run against the deal. Only buyers whose passport lets them reach a seller count.",
    evidencedBy: "At least one mandate satisfied on every hard criterion.",
    built: true,
  },
  {
    key: "reveal-purchased",
    label: "Reveal purchased",
    what: "A buyer opens the opportunity: the pack, the introduction, and the transaction intelligence.",
    evidencedBy: "A reveal recorded against this deal, not refunded.",
    built: true,
  },
  {
    key: "appraised",
    label: "Appraised and finance matched",
    what: "The full model, the Red Team, the capital stack, and the funders whose mandates fit.",
    evidencedBy: "Funding evidence, or a lender offer, recorded on the deal.",
    built: true,
  },
  {
    key: "negotiating",
    label: "Viewing and negotiation",
    what: "The price band is computed and offers are made and answered inside it. Nothing is ever countered above the walk-away price.",
    evidencedBy: "The deal recorded as in the market.",
    built: true,
  },
  {
    key: "offer-accepted",
    label: "Offer accepted",
    what: "A price is agreed, by a named person, with the reasoning recorded.",
    evidencedBy: "The deal recorded as funded — a price agreed with capital behind it.",
    built: true,
  },
  {
    key: "professionals-appointed",
    label: "Professionals appointed",
    what: "Conveyancer, surveyor and whoever else the transaction needs.",
    evidencedBy: "A solicitor recorded as instructed.",
    built: true,
  },
  {
    key: "progressing",
    label: "Transaction progression",
    what: "The milestones are tracked and the blockers surfaced while there is still time to clear them.",
    evidencedBy: "At least one milestone past not-started.",
    built: true,
  },
  {
    key: "completed",
    label: "Completion and fee distribution",
    what: "The sale completes and the fees that are due may be raised — the seller's success fee among them.",
    evidencedBy: "The deal recorded as completed.",
    built: true,
  },
  {
    key: "portfolio",
    label: "Portfolio OS",
    what: "The property enters the buyer's portfolio: performance, refinancing windows, and the next acquisition.",
    // Deliberately honest. Drawing this as working would misrepresent the
    // product to whoever reads the page, and it is the one step nothing here
    // implements.
    evidencedBy: "Not built. Nothing records a property after completion.",
    built: false,
  },
];

export function stageDefinition(key: StageKey): StageDefinition {
  const found = STAGES.find((s) => s.key === key);
  if (found === undefined) throw new Error(`No stage definition for "${key}".`);
  return found;
}

/**
 * What is recorded about a deal, reduced to the facts the workflow reads.
 *
 * A flat shape rather than the record itself, so this stays pure and so the
 * derivation is legible: every field here is a thing somebody had to record,
 * and no field is a stage anybody set.
 */
export interface WorkflowFacts {
  readonly saleConfirmed: boolean;
  readonly sellerChecked: boolean;
  readonly materialComplete: boolean;
  readonly protectionBlocked: boolean;
  readonly matchedMandates: number;
  readonly revealsSold: number;
  readonly fundingEvidenceRecorded: boolean;
  /** Lender offers recorded against the deal. */
  readonly offersRecorded: number;
  readonly solicitorInstructed: boolean;
  readonly milestonesStarted: number;
  readonly status: DealStatus;
}

export interface StageStatus {
  readonly stage: StageDefinition;
  readonly reached: boolean;
  /** Why it has or has not been reached, from what is recorded. */
  readonly detail: string;
}

export interface WorkflowPosition {
  /** The furthest stage whose evidence exists, walking from the start. */
  readonly at: StageDefinition;
  readonly stages: readonly StageStatus[];
  /** What has to be recorded to move on. Empty at the end of what is built. */
  readonly next: string | undefined;
  readonly summary: string;
  readonly version: string;
}

/**
 * Where the deal is.
 *
 * The deal is at the last stage whose evidence exists *walking forward from
 * the start* — the first gap stops it. A deal with an accepted offer and no
 * seller checks is not at "offer accepted", it is stuck at the check, and
 * reporting the furthest touched step instead is how a transaction reaches
 * exchange with a hole in it.
 */
export function workflowPosition(facts: WorkflowFacts): WorkflowPosition {
  const evidence: Readonly<Record<StageKey, { readonly met: boolean; readonly detail: string }>> = {
    discovered: { met: true, detail: "The deal exists." },
    "authority-verified": {
      met: facts.saleConfirmed && facts.sellerChecked,
      detail: !facts.saleConfirmed
        ? "Nobody with authority has confirmed it is for sale."
        : !facts.sellerChecked
          ? "The sale is confirmed, but the seller's due diligence is not complete."
          : "Confirmed for sale, and the seller checked.",
    },
    "opportunity-protected": {
      met: facts.materialComplete && !facts.protectionBlocked,
      detail: facts.protectionBlocked
        ? "Seller Protection blocks this deal. There is no opportunity to protect."
        : facts.materialComplete
          ? "Material information answered; the property may be marketed."
          : "Part A of the material information is not answered, so it may not be marketed.",
    },
    "buyers-matched": {
      met: facts.matchedMandates > 0,
      detail:
        facts.matchedMandates > 0
          ? `${facts.matchedMandates} mandate${facts.matchedMandates === 1 ? "" : "s"} satisfied on every hard criterion.`
          : "No buying mandate is satisfied on every hard criterion.",
    },
    "reveal-purchased": {
      met: facts.revealsSold > 0,
      detail:
        facts.revealsSold > 0
          ? `${facts.revealsSold} buyer${facts.revealsSold === 1 ? " has" : "s have"} opened it.`
          : "Nobody has opened it yet.",
    },
    appraised: {
      met: facts.fundingEvidenceRecorded || facts.offersRecorded > 0,
      detail: facts.fundingEvidenceRecorded
        ? `Funding evidence recorded${facts.offersRecorded > 0 ? `, and ${facts.offersRecorded} lender offer${facts.offersRecorded === 1 ? "" : "s"} against it` : ""}.`
        : facts.offersRecorded > 0
          ? `${facts.offersRecorded} lender offer${facts.offersRecorded === 1 ? "" : "s"} recorded, but nothing about title or valuation.`
          : "Nothing is recorded about title, valuation or the capital behind it.",
    },
    negotiating: {
      // Derived from the deal's own status rather than from a negotiation
      // record, because there is no record of a purchase offer — the price
      // band is computed and the conversation happens outside the platform.
      // Saying so is better than inventing a field nothing writes.
      met: ["in-market", "funded", "completed"].includes(facts.status),
      detail: ["in-market", "funded", "completed"].includes(facts.status)
        ? "The deal is in the market, so the price band applies and offers may be answered inside it."
        : `The deal is "${facts.status}" and is not being marketed yet.`,
    },
    "offer-accepted": {
      met: ["funded", "completed"].includes(facts.status),
      detail: ["funded", "completed"].includes(facts.status)
        ? "A price is agreed and the funding is arranged against it."
        : "No price agreed.",
    },
    "professionals-appointed": {
      met: facts.solicitorInstructed,
      detail: facts.solicitorInstructed
        ? "A conveyancer is instructed."
        : "No conveyancer recorded as instructed.",
    },
    progressing: {
      met: facts.milestonesStarted > 0,
      detail:
        facts.milestonesStarted > 0
          ? `${facts.milestonesStarted} milestone${facts.milestonesStarted === 1 ? "" : "s"} under way.`
          : "No milestone has been started.",
    },
    completed: {
      met: facts.status === "completed",
      detail: facts.status === "completed" ? "Completed." : `The deal is "${facts.status}".`,
    },
    portfolio: {
      met: false,
      detail: "Not built. Nothing records a property after completion.",
    },
  };

  const stages = STAGES.map((stage): StageStatus => {
    const found = evidence[stage.key];
    return { stage, reached: found.met, detail: found.detail };
  });

  // Walk forward and stop at the first gap. The furthest *touched* step is a
  // different and much less useful number.
  let at = STAGES[0];
  if (at === undefined) throw new Error("The workflow has no stages.");
  for (const status of stages) {
    if (!status.reached) break;
    at = status.stage;
  }

  const blocked = stages.find((s) => !s.reached);
  const next =
    blocked === undefined || !blocked.stage.built ? undefined : `${blocked.stage.label}: ${blocked.detail}`;

  return {
    at,
    stages,
    next,
    summary:
      next === undefined
        ? `At ${at.label.toLowerCase()}, which is as far as this platform goes — the property entering a buyer's portfolio is specified and not built.`
        : `At ${at.label.toLowerCase()}. ${next}`,
    version: WORKFLOW_VERSION,
  };
}

import type { StageKey, WorkflowPosition } from "@shared/domain/workflow";

/**
 * The sourcer/flipper walkthrough: the deal lifecycle told from the chair of
 * the person who finds the property, works the deal, and gets paid a fee on it.
 *
 * It is NOT a second lifecycle. `workflow.ts` already walks the twelve steps
 * from a property being noticed to it sitting in a portfolio, and derives where
 * a deal is from what is recorded rather than from somebody clicking "next".
 * This layer hangs the *operational* half on those same twelve stages — what
 * the sourcer actually does and says at each one, and the compliance
 * obligations that travel with it — so the walkthrough a sourcer follows and
 * the stage the engine computes can never drift apart. Advance is still earned
 * by evidence, never asserted here.
 *
 * Two rules this module keeps, because they are the ones a walkthrough gets
 * wrong:
 *
 *  - **It states method and obligation, never a figure.** The max offer, the
 *    SDLT, the walk-away ceiling, the seller's net — those are computed per deal
 *    by `jurisdictions/`, `negotiation.ts`, `director.ts` and `fees.ts`, and the
 *    surface reads them live. Nothing numeric is baked in here (decisions #4, #6).
 *  - **The fee is earned on legal completion, and the obligations that make it
 *    payable are named at the stage they arise** — not left to the end, where a
 *    missing signature or an unverified mandate turns a completed purchase into
 *    an unpaid one (decision #81, `fees.ts`).
 *
 * The content is England-and-Wales practice as a sourcer acting for an investor
 * on a completion-only fee. The legal *rulings* a deal needs still route through
 * `jurisdictions/`; this is the guidance over that engine.
 */

export const SOURCER_WALKTHROUGH_VERSION = "sourcer-walkthrough-1";

/**
 * The one-time readiness a sourcer needs before working any deal — HMRC's own
 * guidance treats deal sourcing as estate agency work, so this is not optional
 * polish. Separate from the per-deal stages because it is established once and
 * then relied on, not repeated per property.
 */
export interface Prerequisite {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
}

export const SOURCER_PREREQUISITES: readonly Prerequisite[] = [
  {
    key: "aml-redress",
    title: "Supervised and in a redress scheme",
    detail:
      "Register for HMRC anti-money-laundering supervision and join an approved residential property redress scheme before trading in scope. Have a business risk assessment, client-check process, complaints process and records in place, and keep identity documents in a restricted system, separate from the deal packs you circulate.",
  },
  {
    key: "investor-brief",
    title: "A signed investor buying mandate",
    detail:
      "Not “send me anything below market value”. Record the legal buyer (named company, number, authorised director), target stock, maximum cash and evidenced funding, condition appetite, the minimum profit hurdle, the exit, who approves an offer and how fast, and completion readiness. It is what you buy against.",
  },
  {
    key: "fee-terms",
    title: "Signed fee terms, before any introduction",
    detail:
      "Give the investor the required fee information before they enter the sourcing contract (Estate Agents Act s.18): who pays, the amount and VAT, and the trigger — here, legal completion of a qualifying purchase from your documented introduction. Cover failed deals, pre-existing leads, connected-buyer circumvention, and the payment route. An NDA protects confidentiality; the sourcing agreement creates the payment obligation.",
  },
];

/** One stage of the walkthrough, tied to a workflow stage by its key. */
export interface WalkStep {
  readonly key: StageKey;
  /** Sourcer-facing title for the stage. */
  readonly title: string;
  /** What the sourcer does here. */
  readonly actions: readonly string[];
  /** The compliance obligations that arise at this stage. */
  readonly obligations: readonly string[];
  /** A line to say or send, where the stage has one. */
  readonly script?: string;
  /** How this stage relates to getting paid, where it does. */
  readonly feeNote?: string;
}

/**
 * The twelve stages, in order, keyed to `workflow.ts` so the surface can mark
 * each one done/current/upcoming from the deal's real position.
 */
export const SOURCER_WALKTHROUGH: readonly WalkStep[] = [
  {
    key: "discovered",
    title: "Open the lead the moment you see it",
    actions: [
      "Record the address, date, source, asking price and history, listing agent, tenure and occupancy if known, and the evidence you may lawfully keep.",
      "Give it a unique deal reference, and separate verified facts from what someone told you and from your own assumptions.",
      "If it is “reduced” or “back on the market”, find out what stopped the last sale — a lost mortgage, a title or construction-type rejection changes the price and the buyer pool.",
    ],
    obligations: [
      "Only retain listing material you are entitled to keep; never scrape a portal.",
    ],
  },
  {
    key: "authority-verified",
    title: "Reach the right person, and check who they are",
    actions: [
      "Identify who you should approach — the listing agent, the owner, or an attorney/executor — and establish who can instruct and who can sign.",
      "Run a seller qualification call: authority, situation, priority and date, occupancy, any previous failed sale, condition, the price (and whether it is the sale price or what they need to clear), and the next action.",
      "Carry out customer due diligence on the other party when the offer is accepted; a seller's agent or solicitor having checked them does not discharge your own duty.",
    ],
    obligations: [
      "PECR governs electronic contact: screen against TPS and your suppression list, give the required privacy information, and honour an objection. A letter is the safe off-market approach.",
      "If capacity, authority or coercion is in doubt, pause and involve the seller's independent conveyancer. Avoid artificial deadlines and guaranteed-completion promises.",
    ],
    script:
      "Hello, I’m [name] from [business]. I work with a buyer looking for a property in this area. If you own [address] and would consider selling, I’d be happy to explain how the buyer would assess it and what the process involves. The buyer would purchase directly from you, and my fee would be paid by the buyer. If you’d prefer no further contact, tell me and I’ll record that.",
  },
  {
    key: "opportunity-protected",
    title: "Make it something that may lawfully be marketed",
    actions: [
      "Let Seller Protection run and answer the material information — Part A before anything is marketed.",
      "Record every question in one of three states: stated, not applicable, or not known and here is who was asked. “No covenants” and “nobody looked” are not the same.",
    ],
    obligations: [
      "Omitting a “not known” is a misleading omission under the CPRs. An unanswered Part A stops the property being marketed at all.",
    ],
  },
  {
    key: "buyers-matched",
    title: "Match it to a funded buyer mandate",
    actions: [
      "Run the Buy Boxes against the deal. Only buyers whose readiness lets them lawfully reach a seller count.",
      "Confirm your investor's mandate is satisfied on every hard criterion before you build the offer.",
    ],
    obligations: [
      "Nobody reaches a seller before identity and funding are checked — an investor you know the name of and nothing else is a refusal, not a match.",
    ],
  },
  {
    key: "reveal-purchased",
    title: "Take the deal — your hold begins",
    actions: [
      "Reveal the opportunity: the pack, the introduction and the transaction intelligence. As a flipper or sourcer this starts your hold on the deal.",
      "A reveal the lock refuses is never charged — so a refused reveal is not a failure to pay for, it is the system protecting a deal already taken.",
    ],
    obligations: [
      "Your hold shares a limited pool and lasts a fixed window; an accepted offer by any holder locks the others out.",
    ],
    feeNote: "Revealing is what establishes you as the sourcer on this deal.",
  },
  {
    key: "appraised",
    title: "Price it as-is and after works — with your fee in the model",
    actions: [
      "Build two evidenced values: the conservative current (as-is) value and a conservative resale value after the defined works, from achieved Land Registry prices, never asking prices.",
      "View it like a buyer who funds the surprises: tie every suspected defect to an investigation, a cost or a decision, and keep an explicit list of what you could not inspect.",
      "Compute the maximum offer with transfer tax, works and contingency, finance, holding and resale costs AND your sourcing fee included — then check it clears the investor's profit hurdle and survives a downside.",
    ],
    obligations: [
      "Every figure is the engine's, for this deal and this jurisdiction — SDLT/LTT, the price band and the profit are computed, never typed in. A worked example is labelled as one.",
      "Profit and cash are different tests: confirm the investor can fund the deposit, completion equity, fees and works before any lender drawdown.",
    ],
  },
  {
    key: "negotiating",
    title: "Offer inside your authority, never above the walk-away",
    actions: [
      "Lead with price, buyer and ability to perform, subject to contract, survey and title. Give the main facts that explain the offer and let the seller weigh speed and certainty.",
      "Get written approval from the investor before changing price or taking on an obligation. Reopen price only when new evidence genuinely changes the deal, not to recover a known cost at the last minute.",
    ],
    obligations: [
      "The walk-away price is computed, not chosen — never counter above it. Consumer protection rules bar misleading statements, omissions and pressure selling.",
    ],
    script:
      "My client, [legal buyer], can offer £[amount], subject to contract, satisfactory survey and title checks, and the stated funding position. The offer assumes vacant possession and the listed fixtures. We can provide funding evidence and instruct a conveyancer promptly. The principal costs affecting the price are [the works]. Our target completion date is [date], subject to the legal and funding checks.",
  },
  {
    key: "offer-accepted",
    title: "Agree the price, and estimate the seller's net",
    actions: [
      "A named person agrees the price, with the reasoning recorded.",
      "Estimate the seller's gross-to-net — sale price less redemption (and any charge), their legal fees, and any existing agent's commission — so an “I need £X in the bank” objection is tested against real numbers. Their conveyancer confirms the actual figures.",
    ],
    obligations: [
      "Your fee sits on the investor's side, not in the seller's statement. If redemption and costs exceed the proceeds, establish the arrangement through the conveyancers before relying on completion.",
    ],
  },
  {
    key: "professionals-appointed",
    title: "Instruct the professionals and issue the memorandum",
    actions: [
      "Get both conveyancers instructed (the buyer's firm able to act for the lender if financed). Issue or request the memorandum of sale with the exact names, legal buyer and company number, price, tenure, vacant-possession status, fixtures and both conveyancers' details.",
      "Lodge your fee evidence now: the signed sourcing agreement, the timestamped property-specific introduction, the investor's written offer approval and the buyer's acknowledgement of the fee. Tell the buyer's conveyancer about the fee early.",
    ],
    obligations: [
      "The memorandum records the commercial position; the conveyancers handle the binding contract. An invoice to a solicitor creates no payment authority on its own.",
    ],
    feeNote: "This is where the payment file is built — before completion, not after.",
  },
  {
    key: "progressing",
    title: "Run the tracker, clear the blockers, exchange when ready",
    actions: [
      "Keep a milestone tracker with an owner and a date for every blocker — searches and title, survey and priced works, funding (confirm the net advance and drawdown lead time, not the headline loan), vacant possession or tenancy handover, the leasehold pack, probate or company authority.",
      "“Waiting on legal” is not a status. A usable update names the next action, the owner and the date, and what happens if it slips.",
      "Exchange only when the conveyancers and the buyer are ready, the deposit is available and the completion date works with lender drawdown. Exchange makes the sale binding; prepare your invoice for settlement.",
    ],
    obligations: [
      "Gate the specific risks before promising a date: tenanted occupation and possession route, leasehold costs and building-safety requirements, and who can sign on a probate, trust or company sale. If a quick resale is assumed, check the onward lender's policy on a recently registered proprietor.",
    ],
  },
  {
    key: "completed",
    title: "Complete, follow the money, and get paid",
    actions: [
      "Put both payment routes in writing before completion day — the property funds through the conveyancers, and your fee invoice to the legal entity that owes it, with the deal reference, amount, VAT and due date.",
      "On legal completion, the fee is earned. The simplest route is the investor paying you directly from their business account on the trigger; match the cleared payment to the invoice and issue a receipt.",
    ],
    obligations: [
      "A fee needs its four things — the permission, the stage, the disclosure to the seller, and a named person raising it — and the seller's one success fee needs their signature and that they are not still under sole agency. The purchase tax return is due within the statutory deadline (14 days for SDLT); SRA rules restrict using a client account as a banking facility.",
    ],
    feeNote: "Legal completion is the trigger. Raise the fee against the correct entity and route.",
  },
  {
    key: "portfolio",
    title: "Hand the property into the portfolio",
    actions: [
      "Record the holding facts — what it is worth (evidenced or marked an assumption), what is owed, when the facility ends, and what a refinance would release.",
    ],
    obligations: [
      "A value is evidenced or it is an assumption, and the difference is printed; the refinance window is a date computed from completion and the term, not a status.",
    ],
  },
];

/** How a deal falling off the happy path is handled, under the signed terms. */
export interface WalkException {
  readonly situation: string;
  readonly nextAction: string;
}

export const SOURCER_EXCEPTIONS: readonly WalkException[] = [
  {
    situation: "The deal falls through before exchange",
    nextAction:
      "Close it as aborted, record the cause, and account only for expressly agreed expenses. A completion-only fee has not triggered.",
  },
  {
    situation: "The buyer misses completion after exchange",
    nextAction:
      "The contractual default, notice and deposit position sits with the conveyancers. Your completion-only fee becomes due if and when the qualifying purchase completes.",
  },
  {
    situation: "The investor wants to substitute a new company",
    nextAction:
      "Re-check funding, CDD, solicitor instructions and lender consent, and resolve in writing who owes your fee before the substitution proceeds. Changing the buyer on a spreadsheet does not make an unsigned company liable.",
  },
  {
    situation: "The investor buys directly after your introduction",
    nextAction:
      "Preserve the timestamped introduction and transaction evidence, and apply the agreed scope and any valid connected-buyer clause. Establish the facts before alleging circumvention.",
  },
  {
    situation: "The purchase completes and the investor does not pay",
    nextAction:
      "Confirm completion, check the invoice entity and due date, send a written demand to the contracting party, and follow the agreement's dispute route.",
  },
];

export type WalkState = "done" | "current" | "upcoming";

export interface WalkStepStatus {
  readonly step: WalkStep;
  readonly state: WalkState;
  /** Why, from what the deal records — carried through from the workflow. */
  readonly detail: string;
}

export interface WalkthroughView {
  readonly steps: readonly WalkStepStatus[];
  /** The stage to work now: the first one not yet reached, or the last if done. */
  readonly current: WalkStepStatus;
  /** What has to be recorded to advance, from the workflow. Undefined at the end. */
  readonly nextGate: string | undefined;
  /** Reached stages over total, for a progress meter. */
  readonly fractionDone: number;
  readonly version: string;
}

function stepFor(key: StageKey): WalkStep {
  const found = SOURCER_WALKTHROUGH.find((s) => s.key === key);
  if (found === undefined) throw new Error(`No walkthrough step for stage "${key}".`);
  return found;
}

/**
 * Project a deal's live workflow position into the sourcer walkthrough.
 *
 * The state of each step is the workflow's own: a stage the engine says is
 * reached is `done`; the first unreached stage is `current` (what to do now);
 * the rest are `upcoming`. Nothing here decides a stage is reached — it only
 * dresses the engine's answer with the sourcer's actions. When every built
 * stage is reached the last one is `current`, so the walkthrough always points
 * somewhere rather than nowhere.
 */
export function sourcerWalkthrough(position: WorkflowPosition): WalkthroughView {
  const reachedByKey = new Map(position.stages.map((s) => [s.stage.key, s]));
  const firstUnreached = position.stages.find((s) => !s.reached)?.stage.key;
  const currentKey = firstUnreached ?? position.stages[position.stages.length - 1]?.stage.key;

  const steps: WalkStepStatus[] = SOURCER_WALKTHROUGH.map((step) => {
    const status = reachedByKey.get(step.key);
    const reached = status?.reached ?? false;
    const state: WalkState = reached ? "done" : step.key === currentKey ? "current" : "upcoming";
    return { step, state, detail: status?.detail ?? "" };
  });

  const current = steps.find((s) => s.state === "current") ?? steps[steps.length - 1]!;
  const reachedCount = position.stages.filter((s) => s.reached).length;

  return {
    steps,
    current,
    nextGate: position.next,
    fractionDone: position.stages.length === 0 ? 0 : reachedCount / position.stages.length,
    version: SOURCER_WALKTHROUGH_VERSION,
  };
}

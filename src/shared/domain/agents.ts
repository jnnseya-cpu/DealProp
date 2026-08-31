import { abs, bps, ratioBps, sub, ZERO, type Money } from "@shared/money";
import { gbp, percent } from "@shared/format";
import { looksMispriced, type BorrowingReport } from "@shared/domain/borrowing";
import { STANDARD_MILESTONES, type CloseReport, type Milestone } from "@shared/domain/completion";
import { REFINANCE_DSCR_COVENANT, type FundingMetrics } from "@shared/domain/fundingMetrics";
import {
  checkPromotionLanguage,
  type BorrowerFacts,
  type RouteDecision,
} from "@shared/domain/regulatoryRoute";
import type { DirectorBriefing } from "@shared/domain/director";
import type { FundingEvidence, ReadinessReport } from "@shared/domain/fundingReadiness";
import type { FundingBox, MatchResult } from "@shared/domain/matching";
import type { OfferComparisonReport, OfferTerms } from "@shared/domain/offers";
import type { DealStatus } from "@shared/domain/types";

/**
 * The nine agents of specification §12.
 *
 * Read the word "agent" carefully, because it is doing less work here than it
 * does in most product copy. An agent in this platform is three things and no
 * fourth: a **trigger** that says when it has something to say, an **observer**
 * that runs the engines that already exist, and a **proposal** that a named
 * human must decide on. There is no model in the loop and no autonomy in it.
 *
 * That is not caution for its own sake. §12 ends with a sentence that is a
 * design constraint, not a disclaimer: agents "may draft messages and tasks but
 * cannot impersonate a professional, bind a party, accept terms, certify
 * investor status, waive conditions or move funds". An agent that could do any
 * of those would have to be trusted, and nothing that produces a number from a
 * probability distribution can be trusted with a party's money. So the whole
 * design question is how to make the forbidden list unreachable rather than
 * discouraged, and the answer is in three places:
 *
 *  1. **A closed set of effects.** Accepting a proposal can record a review, a
 *     selection or a sign-off, or adopt the standard conditions plan. There is
 *     no effect in the union that moves money, alters terms, marks a condition
 *     satisfied or writes a certification, so no agent can propose one — the
 *     type will not hold the value.
 *  2. **Effect ownership.** `EFFECT_OWNERS` says which agents may produce which
 *     effect, checked at construction. The one writing effect belongs to one
 *     agent and would throw anywhere else.
 *  3. **A named decider.** `authoriseDecision()` refuses the shared operator
 *     password. A sign-off is a statement somebody made, and there is nobody
 *     behind a shared credential to have made it.
 *
 * Every figure in every proposal comes from an engine that was already tested.
 * Nothing here computes economics; if a proposal states a number, it read it
 * from the appraisal, the readiness report, the close report or the offer
 * comparison, and `evidence` says which.
 */

export const AGENTS_VERSION = "agents-1";

export type AgentId =
  | "intake"
  | "structuring"
  | "risk"
  | "matching"
  | "memorandum"
  | "terms"
  | "due-diligence"
  | "completion"
  | "exit-watch";

/**
 * What an agent is allowed to produce.
 *
 * Deliberately verbs about output, not about the world. "reconcile" means show
 * two values that disagree; it does not mean pick one.
 */
export type AgentCapability =
  | "reconcile"
  | "propose-option"
  | "quantify-risk"
  | "rank"
  | "draft"
  | "compare"
  | "propose-task"
  | "forecast"
  | "alert";

/**
 * The §12 prohibitions, as data rather than as prose in a comment.
 *
 * Nothing reads this to make a decision — the decisions are structural, above.
 * It exists so the constraint is visible at the point of change: anybody adding
 * an effect to `ProposalEffect` has to look at this list and say why the new
 * effect is not on it.
 */
export const FORBIDDEN_ACTS: Readonly<Record<string, string>> = {
  "impersonate-professional":
    "No output may be presented as the work of a solicitor, valuer, accountant or broker.",
  "bind-party": "No agent output commits anybody to anything.",
  "accept-terms": "An offer is selected by a person, recorded with their name and their reason.",
  "certify-investor": "A certification is a statement the investor signs. Nothing else can make it.",
  "waive-condition": "A condition is waived by a person with the standing to waive it, never by a run.",
  "move-funds": "No agent has any path to the ledger, the provider or a bank instruction.",
};

/**
 * What accepting a proposal actually does.
 *
 * Three of the four record that a human decided something. The fourth writes
 * the standard conditions plan at "not started" and can write nothing else — it
 * cannot mark a condition satisfied, which is what §19.8's four-eyes control
 * protects.
 */
export type ProposalEffect =
  | "record-review"
  | "record-selection"
  | "record-sign-off"
  | "adopt-conditions-plan";

/** Which agents may produce which effect. Checked when a proposal is built. */
export const EFFECT_OWNERS: Readonly<Record<ProposalEffect, readonly AgentId[]>> = {
  "record-review": ["intake", "risk", "completion", "exit-watch", "due-diligence"],
  "record-selection": ["structuring", "terms"],
  "record-sign-off": ["matching", "memorandum"],
  "adopt-conditions-plan": ["due-diligence"],
};

/**
 * Who has to decide, in the specification's own words.
 *
 * §2's nine-role model is not built and is recorded as outstanding, so in this
 * platform each of these is an operator or an administrator acting under their
 * own name. The label is kept because it says what kind of judgement is being
 * asked for, which "operator" does not.
 */
export type HumanControl =
  | "Sponsor confirms conflicts"
  | "Deal Manager selects route"
  | "Underwriter reviews"
  | "Manager approves transmission"
  | "Manager signs off"
  | "No automatic acceptance"
  | "Humans approve or waive"
  | "Solicitor or funder confirms close"
  | "Asset manager acts";

/**
 * How much weight a proposal's figures will bear.
 *
 * A label rather than a percentage, because a percentage would be invented. The
 * three values have definitions: `recorded` means every figure came from
 * evidence somebody entered, `modelled` means it rests on a price or structure
 * the platform derived rather than agreed, `assumed` means it rests on a
 * default that nobody has confirmed.
 */
export type Confidence = "recorded" | "modelled" | "assumed";

export type Severity = "blocker" | "action" | "watch";

export interface AgentDefinition {
  readonly id: AgentId;
  readonly name: string;
  /** When it has something to say, in a sentence. */
  readonly trigger: string;
  readonly output: string;
  readonly humanControl: HumanControl;
  readonly capabilities: readonly AgentCapability[];
}

export const AGENTS: readonly AgentDefinition[] = [
  {
    id: "intake",
    name: "Intake Agent",
    trigger: "A deal is created, or evidence is recorded against it.",
    output: "The record reconciled against what has been evidenced, with contradictions named.",
    humanControl: "Sponsor confirms conflicts",
    capabilities: ["reconcile", "propose-task"],
  },
  {
    id: "structuring",
    name: "Structuring Agent",
    trigger: "Enough is known to appraise the deal.",
    output: "Capital-stack alternatives, with what each one costs.",
    humanControl: "Deal Manager selects route",
    capabilities: ["propose-option"],
  },
  {
    id: "risk",
    name: "Risk Agent",
    trigger: "Any change to the deal or its market inputs.",
    output: "The stresses that break it, and by how much.",
    humanControl: "Underwriter reviews",
    capabilities: ["quantify-risk"],
  },
  {
    id: "matching",
    name: "Matching Agent",
    trigger: "The regulatory route permits an introduction and protection is clear.",
    output: "Eligible funders, ranked, with the reason each qualifies.",
    humanControl: "Manager approves transmission",
    capabilities: ["rank"],
  },
  {
    id: "memorandum",
    name: "Memorandum Agent",
    trigger: "The pack scores as fundable.",
    output: "A memorandum whose every figure is traceable, checked for promotion language.",
    humanControl: "Manager signs off",
    capabilities: ["draft"],
  },
  {
    id: "terms",
    name: "Terms Agent",
    trigger: "An offer is recorded.",
    output: "Offers normalised to one basis and compared on total cost.",
    humanControl: "No automatic acceptance",
    capabilities: ["compare"],
  },
  {
    id: "due-diligence",
    name: "Due-Diligence Agent",
    trigger: "Terms have been selected.",
    output: "A conditions plan, and a chaser for whoever is holding each one up.",
    humanControl: "Humans approve or waive",
    capabilities: ["propose-task", "draft"],
  },
  {
    id: "completion",
    name: "Completion Agent",
    trigger: "Evidence is expiring, or the critical path is blocked.",
    output: "A close forecast and what is standing in its way.",
    humanControl: "Solicitor or funder confirms close",
    capabilities: ["forecast"],
  },
  {
    id: "exit-watch",
    name: "Exit Watch Agent",
    trigger: "The deal is funded or completed.",
    output: "Covenant, maturity and refinance alerts.",
    humanControl: "Asset manager acts",
    capabilities: ["alert"],
  },
];

export function agentById(id: AgentId): AgentDefinition {
  const found = AGENTS.find((a) => a.id === id);
  // Exhaustive by construction: AgentId and AGENTS are edited together, and a
  // missing entry is a programming error rather than a runtime condition.
  if (found === undefined) throw new Error(`No agent definition for "${id}".`);
  return found;
}

export interface ProposedAction {
  readonly effect: ProposalEffect;
  /** What the button says. */
  readonly label: string;
}

export interface AgentProposal {
  readonly agentId: AgentId;
  /** Stable across runs, so a decision survives re-running the agents. */
  readonly key: string;
  readonly severity: Severity;
  readonly headline: string;
  /** Plain English. §5 requires an explanation, not a code. */
  readonly detail: string;
  /** Which inputs this was read from. §5's input references. */
  readonly evidence: readonly string[];
  /** What had to be taken on trust. Empty is a claim, so it is populated. */
  readonly assumptions: readonly string[];
  readonly confidence: Confidence;
  readonly action: ProposedAction;
  readonly humanControl: HumanControl;
  /** §5: which version of the logic produced this. */
  readonly version: string;
  /**
   * How this was produced.
   *
   * Always "deterministic" today, and stated rather than assumed. If a model is
   * ever put behind one of these agents, this field is where it becomes visible
   * to the person deciding, and every existing proposal keeps its meaning.
   */
  readonly engine: "deterministic";
}

interface ProposalDraft {
  readonly key: string;
  readonly severity: Severity;
  readonly headline: string;
  readonly detail: string;
  readonly evidence: readonly string[];
  readonly assumptions: readonly string[];
  readonly confidence: Confidence;
  readonly capability: AgentCapability;
  readonly action: ProposedAction;
}

/**
 * Build a proposal, refusing one the agent is not entitled to make.
 *
 * Two checks, both of which have caught real mistakes in development: an agent
 * producing output outside its declared capabilities, and an agent reaching for
 * the one effect that writes to the deal. Throwing is right here — a proposal
 * that should not exist must not be rendered with a button next to it, and a
 * silent drop would leave the operator looking at a board that had quietly
 * decided not to mention something.
 */
export function propose(agent: AgentDefinition, draft: ProposalDraft): AgentProposal {
  if (!agent.capabilities.includes(draft.capability)) {
    throw new Error(
      `${agent.name} may not "${draft.capability}". Its capabilities are ${agent.capabilities.join(", ")}.`,
    );
  }
  const owners = EFFECT_OWNERS[draft.action.effect];
  if (!owners.includes(agent.id)) {
    throw new Error(
      `${agent.name} may not produce the effect "${draft.action.effect}". That belongs to ${owners.join(", ")}.`,
    );
  }
  return {
    agentId: agent.id,
    key: `${agent.id}:${draft.key}`,
    severity: draft.severity,
    headline: draft.headline,
    detail: draft.detail,
    evidence: draft.evidence,
    assumptions: draft.assumptions,
    confidence: draft.confidence,
    action: draft.action,
    humanControl: agent.humanControl,
    version: AGENTS_VERSION,
    engine: "deterministic",
  };
}

/* ------------------------------------------------------------- decisions */

export interface AgentDecision {
  readonly id: string;
  readonly dealId: string;
  readonly agentId: AgentId;
  readonly proposalKey: string;
  readonly decision: "accepted" | "dismissed";
  /** The named person. There is deliberately no path for an unnamed one. */
  readonly byAccountId: string;
  readonly byName: string;
  readonly note: string;
  readonly at: string;
  /** The headline as it stood, so the record still reads later. */
  readonly proposalHeadline: string;
  readonly effect: ProposalEffect;
}

/** Who is deciding. Mirrors the viewer the guard produces. */
export type Actor =
  | {
      readonly kind: "account";
      readonly id: string;
      readonly name: string;
      readonly email: string;
    }
  | { readonly kind: "shared-operator" };

export interface DecisionAuthorisation {
  readonly ok: boolean;
  readonly reason: string;
}

/**
 * Whether this actor may decide this proposal.
 *
 * The shared operator password is refused, always. Every one of the nine human
 * controls is somebody stating a judgement — the sponsor confirms, the manager
 * signs off, the underwriter reviews — and a shared credential has nobody
 * behind it to be the person who did. The same rule the manual ledger movement
 * follows, for the same reason.
 */
export function authoriseDecision(actor: Actor, note: string): DecisionAuthorisation {
  if (actor.kind !== "account") {
    return {
      ok: false,
      reason:
        "A proposal is decided by a named person. Sign in with your own account — the shared operator password identifies nobody, and a sign-off nobody made is not a sign-off.",
    };
  }
  if (note.trim() === "") {
    return {
      ok: false,
      reason: "Say why. A decision without a reason cannot be reviewed by anybody who was not there.",
    };
  }
  return { ok: true, reason: `Recorded against ${actor.name}.` };
}

/** The standing decision on a proposal, where one has been taken. */
export function decisionFor(
  decisions: readonly AgentDecision[],
  proposalKey: string,
): AgentDecision | undefined {
  return [...decisions]
    .filter((d) => d.proposalKey === proposalKey)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
}

/* --------------------------------------------------------------- context */

/**
 * Everything the agents may read.
 *
 * Assembled once by the caller from the deal record and the engines, so that no
 * observer recomputes anything and two agents cannot disagree about the same
 * figure. Pure data: the observers below are functions of this and nothing else,
 * which is what makes them testable without a store.
 */
export interface AgentContext {
  readonly dealId: string;
  readonly reference: string;
  readonly status: DealStatus;
  /** True where the price and structure were derived rather than agreed. */
  readonly modelled: boolean;
  readonly briefing: DirectorBriefing;
  readonly readiness: ReadinessReport;
  readonly metrics: FundingMetrics;
  readonly borrowing: BorrowingReport;
  /** Absent means unclassified, which is itself a finding. */
  readonly route?: RouteDecision;
  /** The facts the route was classified from, so they can be reconciled. */
  readonly borrowerFacts?: BorrowerFacts;
  readonly evidence: FundingEvidence;
  readonly offers: readonly OfferTerms[];
  readonly comparison: OfferComparisonReport;
  readonly funderMatches: readonly MatchResult<FundingBox>[];
  readonly milestones: readonly Milestone[];
  /** Absent where no conditions plan has been adopted. */
  readonly close?: CloseReport;
  readonly decisions: readonly AgentDecision[];
  readonly now: Date;
}

export interface AgentOutcome {
  readonly agent: AgentDefinition;
  readonly fired: boolean;
  /** Why it has nothing to say, where it has nothing to say. */
  readonly dormantReason?: string;
  readonly proposals: readonly AgentProposal[];
}

export interface AgentRun {
  readonly dealId: string;
  readonly at: string;
  readonly version: string;
  readonly outcomes: readonly AgentOutcome[];
  readonly proposals: readonly AgentProposal[];
  readonly blockers: number;
}

type Observer = (context: AgentContext) => readonly AgentProposal[] | string;

/**
 * Run every agent over one deal.
 *
 * An observer returns proposals, or a string saying why it is dormant. Dormant
 * is a first-class outcome and is shown: an agent that is silent because it has
 * nothing to say and an agent that is silent because it has not been reached
 * look identical otherwise, and the second is the one worth knowing about.
 */
export function runAgents(context: AgentContext): AgentRun {
  const outcomes = AGENTS.map((agent): AgentOutcome => {
    const result = OBSERVERS[agent.id](context);
    if (typeof result === "string") {
      return { agent, fired: false, dormantReason: result, proposals: [] };
    }
    if (result.length === 0) {
      return { agent, fired: true, dormantReason: NOTHING_TO_RAISE[agent.id], proposals: [] };
    }
    return { agent, fired: true, proposals: result };
  });

  const proposals = outcomes.flatMap((o) => o.proposals);

  return {
    dealId: context.dealId,
    at: context.now.toISOString(),
    version: AGENTS_VERSION,
    outcomes,
    proposals: [...proposals].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    blockers: proposals.filter((p) => p.severity === "blocker").length,
  };
}

const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, action: 1, watch: 2 };

const NOTHING_TO_RAISE: Record<AgentId, string> = {
  intake: "Nothing in the record contradicts anything else recorded against it.",
  structuring: "The stack closes on the structure already modelled. No alternative improves it.",
  risk: "No single stress wipes out the profit.",
  matching: "No funder on the platform is eligible for this deal.",
  memorandum: "The pack is ready and the language is clean.",
  terms: "One offer, nothing to compare it against yet.",
  "due-diligence": "Every condition is either complete or moving.",
  completion: "Nothing on the critical path is blocked and no evidence is expiring.",
  "exit-watch": "Cover, headroom and maturity are all within tolerance.",
};

/* ------------------------------------------------------------- observers */

/**
 * How far a valuation may differ from the value the deal is modelled on before
 * the two are treated as disagreeing rather than rounding.
 *
 * Five per cent is the tolerance a lender's own desk review typically applies
 * before it asks a second valuer. Below it the two figures are the same number
 * measured twice; above it, one of them is wrong and nobody knows which — which
 * is exactly the case §19.5 says must become a blocker naming both sources.
 */
export const VALUATION_TOLERANCE_BPS = bps(500);

/** Evidence older than this is stale for a funder, whatever it says. */
export const VALUATION_STALE_MONTHS = 3;

function monthsBetween(from: string, to: Date): number | undefined {
  const then = new Date(from);
  if (Number.isNaN(then.getTime())) return undefined;
  return (to.getFullYear() - then.getFullYear()) * 12 + (to.getMonth() - then.getMonth());
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

const intakeObserver: Observer = (c) => {
  const agent = agentById("intake");
  const out: AgentProposal[] = [];
  const { inputs } = c.briefing;
  const omv = inputs.property.openMarketValue;

  // §19.5 — a valuation and the intake record disagreeing is a blocker, and it
  // names both figures. Choosing one silently is the failure this exists to
  // prevent: the deal would then be appraised on a number nobody agreed to.
  const valued = c.evidence.valuationAmount;
  if (valued !== undefined && omv > 0) {
    const divergence = ratioBps(abs(sub(valued, omv)), omv);
    if (divergence > VALUATION_TOLERANCE_BPS) {
      out.push(
        propose(agent, {
          key: "valuation-conflict",
          severity: "blocker",
          headline: `The valuation and the deal record disagree by ${percent(divergence)}.`,
          detail:
            `The deal is modelled on an open market value of ${gbp(omv)}. ` +
            `${c.evidence.valuerFirm ?? "The valuer"} reported ${gbp(valued)}. ` +
            "Both are recorded and neither has been changed. Confirm which figure the deal proceeds on, " +
            "because every leverage ratio, the margin and the exit headroom are computed from it.",
          evidence: [
            `Intake: open market value ${gbp(omv)}`,
            `Valuation: ${gbp(valued)}${c.evidence.valuationDate !== undefined ? ` as at ${c.evidence.valuationDate}` : ""}`,
          ],
          assumptions: [],
          confidence: "recorded",
          capability: "reconcile",
          action: { effect: "record-review", label: "Confirm which figure stands" },
        }),
      );
    }
  }

  const age =
    c.evidence.valuationDate !== undefined ? monthsBetween(c.evidence.valuationDate, c.now) : undefined;
  if (age !== undefined && age >= VALUATION_STALE_MONTHS) {
    out.push(
      propose(agent, {
        key: "valuation-stale",
        severity: "action",
        headline: `The valuation is ${age} months old.`,
        detail:
          `Dated ${c.evidence.valuationDate}. Most bridging lenders will not accept a report over ` +
          `${VALUATION_STALE_MONTHS} months without a re-inspection or a re-type, and the one that does will ` +
          "re-value at its own cost and its own figure. Commission the refresh before the application, not after.",
        evidence: [`Evidence: valuation dated ${c.evidence.valuationDate}`],
        assumptions: ["Lender appetite for older reports varies; treat this as the common case, not a rule."],
        confidence: "recorded",
        capability: "propose-task",
        action: { effect: "record-review", label: "Acknowledge" },
      }),
    );
  }

  if ((c.evidence.expiredDocuments ?? 0) > 0) {
    const n = c.evidence.expiredDocuments ?? 0;
    out.push(
      propose(agent, {
        key: "expired-documents",
        severity: "blocker",
        headline: `${n} document${n === 1 ? " has" : "s have"} expired.`,
        detail:
          "Expired evidence is not weak evidence, it is absent evidence: a lender's checklist treats an " +
          "out-of-date certificate exactly as it treats a missing one. Replace them before the pack goes out.",
        evidence: [`Evidence: expiredDocuments = ${n}`],
        assumptions: [],
        confidence: "recorded",
        capability: "reconcile",
        action: { effect: "record-review", label: "Acknowledge" },
      }),
    );
  }

  // The borrower facts and the appraisal describing different buyers. Both
  // drive tax, so one of them is producing the wrong number and nothing in the
  // data says which — which is precisely why this is raised rather than
  // resolved.
  const facts = c.borrowerFacts;
  if (facts !== undefined) {
    const asCompany = facts.legalForm !== "individual";
    if (asCompany !== inputs.buyerIsCompany) {
      out.push(
        propose(agent, {
          key: "buyer-form-conflict",
          severity: "blocker",
          headline: `The buyer is modelled as ${inputs.buyerIsCompany ? "a company" : "an individual"} but recorded as ${article(facts.legalForm)} ${facts.legalForm}.`,
          detail:
            "The appraisal charges tax and stamp duty on one basis and the regulatory classification was " +
            "made on the other. Both cannot be right, and the difference is usually worth more than the " +
            "margin — the company surcharge and the corporation-tax treatment both turn on it.",
          evidence: [
            `Intake: buyerIsCompany = ${String(inputs.buyerIsCompany)}`,
            `Borrower facts: legalForm = ${facts.legalForm}`,
          ],
          assumptions: [],
          confidence: "recorded",
          capability: "reconcile",
          action: { effect: "record-review", label: "Confirm which is correct" },
        }),
      );
    }

    // The borrower facts record a country ("GB"), the property a jurisdiction
    // within it ("GB-ENG"). Comparing them directly would fire on every
    // correctly recorded deal, so it is the country that has to agree.
    const assetCountry = inputs.property.jurisdiction.split("-")[0] ?? "";
    if (facts.assetJurisdiction.toUpperCase() !== assetCountry.toUpperCase()) {
      out.push(
        propose(agent, {
          key: "jurisdiction-conflict",
          severity: "blocker",
          headline: `The property is in ${inputs.property.jurisdiction} but the asset is recorded as being in ${facts.assetJurisdiction}.`,
          detail:
            "Every rate on this deal — the transfer tax, the profit tax, the conveyancing route and what " +
            "the platform is even allowed to say — is selected by jurisdiction. Two different answers means " +
            "at least one set of figures was computed under the wrong law.",
          evidence: [
            `Intake: property.jurisdiction = ${inputs.property.jurisdiction}`,
            `Borrower facts: assetJurisdiction = ${facts.assetJurisdiction}`,
          ],
          assumptions: [],
          confidence: "recorded",
          capability: "reconcile",
          action: { effect: "record-review", label: "Confirm which is correct" },
        }),
      );
    }
  }

  if (c.modelled) {
    out.push(
      propose(agent, {
        key: "price-modelled",
        severity: "action",
        headline: "No price has been agreed. Everything below is modelled.",
        detail:
          "The price and structure were derived — priced at the ceiling that clears the target margin on " +
          "the structure the Router ranked first. That is an opportunity, not a transaction, and every " +
          "figure downstream of it inherits the assumption. Record the agreed price to remove this.",
        evidence: ["Working deal: modelled = true"],
        assumptions: ["The seller would accept a price at or below the modelled ceiling."],
        confidence: "modelled",
        capability: "propose-task",
        action: { effect: "record-review", label: "Acknowledge" },
      }),
    );
  }

  return out;
};

const structuringObserver: Observer = (c) => {
  const agent = agentById("structuring");
  const out: AgentProposal[] = [];
  const { stack, strategies, inputs } = c.briefing;
  const confidence: Confidence = c.modelled ? "modelled" : "recorded";

  if (!stack.feasible) {
    out.push(
      propose(agent, {
        key: "stack-does-not-close",
        severity: "blocker",
        headline:
          stack.shortfall > ZERO
            ? `The capital stack is ${gbp(stack.shortfall)} short.`
            : "The capital stack closes but leaves the originator nothing.",
        detail:
          `Requirement ${gbp(stack.requirement)}, raised ${gbp(stack.totalRaised)} across ` +
          `${stack.layers.length} layer${stack.layers.length === 1 ? "" : "s"}. ` +
          (stack.warnings.length > 0 ? stack.warnings.join(" ") : "") +
          " Close it by raising the senior advance, adding a layer, or paying less.",
        evidence: [
          `Capital stack: requirement ${gbp(stack.requirement)}, raised ${gbp(stack.totalRaised)}`,
          ...stack.layers.map((l) => `${l.label}: ${gbp(l.amount)}`),
        ],
        assumptions: ["Default stack preferences, unless they have been changed for this deal."],
        confidence,
        capability: "propose-option",
        action: { effect: "record-selection", label: "Record the route chosen" },
      }),
    );
  }

  const best = strategies.best;
  if (best !== undefined && best.candidate.structure !== inputs.structure) {
    out.push(
      propose(agent, {
        key: `alternative:${best.candidate.structure}:${best.candidate.exit}`,
        severity: "action",
        headline: `"${best.candidate.label}" ranks above the structure currently modelled.`,
        detail:
          `${best.reason} The deal is modelled as ${inputs.structure} exiting by ${inputs.exit}. ` +
          "Selecting a route is a decision with tax and finance consequences that this cannot make for you.",
        evidence: [
          `Strategy Router: ${best.candidate.label} ranked first`,
          `Currently modelled: ${inputs.structure} / ${inputs.exit}`,
        ],
        assumptions: ["The Router compares structures on the same property facts and the same costs."],
        confidence,
        capability: "propose-option",
        action: { effect: "record-selection", label: "Record the route chosen" },
      }),
    );
  }

  return out;
};

const riskObserver: Observer = (c) => {
  const agent = agentById("risk");
  const report = c.briefing.scored.redTeam;
  const out: AgentProposal[] = [];
  const confidence: Confidence = c.modelled ? "modelled" : "recorded";

  for (const result of report.results) {
    if (!result.wipesOutProfit && !result.losesCapital) continue;
    const single = result.stress.tier === "single";
    out.push(
      propose(agent, {
        key: `stress:${result.stress.key}`,
        severity: single && result.losesCapital ? "blocker" : "action",
        headline: `${result.stress.label}: ${result.losesCapital ? "loses capital" : "wipes out the profit"}.`,
        detail:
          `${result.stress.question} Profit moves by ${gbp(result.profitDelta)} to ${gbp(result.profit)}. ` +
          (single
            ? "This is a single factor. One thing going wrong is not a tail event — it is a Tuesday."
            : "This is a compound stress: several things going wrong together. It is worth knowing and it is not a veto."),
        evidence: [
          `Red Team: ${result.stress.key} (${result.stress.tier})`,
          `Base profit ${gbp(report.base.profit)}, stressed ${gbp(result.profit)}`,
        ],
        assumptions: ["The stress is applied to the appraisal as modelled, holding everything else constant."],
        confidence,
        capability: "quantify-risk",
        action: { effect: "record-review", label: "Record the underwriter's review" },
      }),
    );
  }

  if (out.length === 0 && report.resilience < 50) {
    out.push(
      propose(agent, {
        key: "resilience",
        severity: "watch",
        headline: `Resilience ${report.resilience}/100.`,
        detail: report.summary,
        evidence: [`Red Team: worst case ${gbp(report.worstCase)}`],
        assumptions: [],
        confidence,
        capability: "quantify-risk",
        action: { effect: "record-review", label: "Record the underwriter's review" },
      }),
    );
  }

  return out;
};

const matchingObserver: Observer = (c) => {
  const agent = agentById("matching");

  if (c.briefing.scored.protection.blocked) {
    return "Seller Protection has blocked this deal. Nothing goes to a funder while it is blocked.";
  }
  if (c.route === undefined) {
    return "The transaction is not classified. Unclassified routes to review, never to permitted, so no introduction may be made.";
  }
  if (!c.route.mayIntroduce) {
    return `No introduction may be made: ${c.route.reason}`;
  }

  const eligible = c.funderMatches.filter((m) => m.eligible);
  if (eligible.length === 0) return "";

  return eligible.slice(0, 5).map((match) =>
    propose(agent, {
      key: `funder:${match.target.id}`,
      severity: "action",
      headline: `${match.target.funderName} — ${match.score}/100.`,
      detail:
        `${match.criteria.filter((cr) => cr.met).length} of ${match.criteria.length} criteria met. ` +
        `Ticket ${gbp(match.target.minTicket)}–${gbp(match.target.maxTicket)}, up to ${percent(match.target.maxLtvBps)} LTV. ` +
        "Ranking is not permission: sending this deal to this funder is a disclosure, and it is approved by a person.",
      evidence: [
        `Funding Box ${match.target.id}`,
        `Regulatory route: ${c.route?.route ?? "unclassified"}`,
        ...match.criteria.filter((cr) => cr.met).map((cr) => `${cr.label}: ${cr.detail}`),
      ],
      assumptions: ["Mandates are as the funder last recorded them. Appetite moves faster than a Funding Box does."],
      confidence: c.modelled ? "modelled" : "recorded",
      capability: "rank",
      action: { effect: "record-sign-off", label: "Approve transmission" },
    }),
  );
};

const memorandumObserver: Observer = (c) => {
  const agent = agentById("memorandum");

  if (c.readiness.band !== "fundable-pack") {
    return `The pack scores ${c.readiness.score}/100 (${c.readiness.band}). A memorandum drawn from an incomplete pack is a document that has to be withdrawn.`;
  }

  const out: AgentProposal[] = [];

  // The memorandum is a financial promotion. §6 forbids the language; checking
  // it here is what stops a headline the engine generated from going out
  // unread, which is exactly the sentence nobody re-reads.
  const promotional = [c.briefing.headline, ...c.briefing.reasons].join(" ");
  const check = checkPromotionLanguage(promotional);
  for (const finding of check.findings) {
    out.push(
      propose(agent, {
        key: `promotion:${finding.phrase}`,
        severity: "blocker",
        headline: `The memorandum text uses "${finding.phrase}".`,
        detail: `${finding.why} Rewrite it before the pack is issued. Nothing here has changed the wording — a document that silently edits its own promises is worse than one that gets caught.`,
        evidence: ["Memorandum narrative, as generated"],
        assumptions: [],
        confidence: "recorded",
        capability: "draft",
        action: { effect: "record-sign-off", label: "Sign off the memorandum" },
      }),
    );
  }

  if (out.length === 0) {
    out.push(
      propose(agent, {
        key: "sign-off",
        severity: "action",
        headline: `The pack scores ${c.readiness.score}/100 and is ready to sign off.`,
        detail:
          `${c.briefing.headline} Every figure in the memorandum is computed from the appraisal at the ` +
          "moment it is opened, so signing off records that you have read this position — not that the " +
          "document is frozen.",
        evidence: [
          `Readiness ${c.readiness.score}/100 (${c.readiness.band})`,
          ...c.readiness.components.filter((k) => k.earned === k.weight).map((k) => `${k.label}: complete`),
        ],
        assumptions: [c.readiness.caveat],
        confidence: c.modelled ? "modelled" : "recorded",
        capability: "draft",
        action: { effect: "record-sign-off", label: "Sign off the memorandum" },
      }),
    );
  }

  return out;
};

const termsObserver: Observer = (c) => {
  const agent = agentById("terms");
  if (c.offers.length === 0) {
    return "No offers recorded. Ask for at least three, and compare the totals rather than the rates.";
  }

  const out: AgentProposal[] = [];
  const { cheapest, largestAdvance } = c.comparison;

  if (cheapest !== undefined) {
    const differsOnAdvance =
      largestAdvance !== undefined && largestAdvance.terms.id !== cheapest.terms.id;
    out.push(
      propose(agent, {
        key: `cheapest:${cheapest.terms.id}`,
        severity: "action",
        headline: `${cheapest.terms.lender} is cheapest in total: ${gbp(cheapest.cost.total)}.`,
        detail:
          `${c.comparison.summary} ` +
          (differsOnAdvance
            ? `It is not the largest advance — ${largestAdvance.terms.lender} puts ${gbp(largestAdvance.netAdvance)} on the table against ${gbp(cheapest.netAdvance)}, which matters more than the total if the cash is what is short.`
            : "It also puts the most cash on the table.") +
          " Nothing here accepts anything: selecting an offer is a decision, recorded with your name and your reason.",
        evidence: c.comparison.offers.map(
          (o) => `${o.terms.lender} (${o.terms.confidence}): total ${gbp(o.cost.total)}, net advance ${gbp(o.netAdvance)}`,
        ),
        assumptions: [
          "Offers are compared on the same appraisal, at each lender's own term and LTV.",
          "An indicative quote is not an offer. Confidence is shown against each.",
        ],
        confidence: "recorded",
        capability: "compare",
        action: { effect: "record-selection", label: "Record the offer selected" },
      }),
    );
  }

  for (const compared of c.comparison.offers) {
    const warning = looksMispriced(compared.cost);
    if (warning === undefined) continue;
    out.push(
      propose(agent, {
        key: `mispriced:${compared.terms.id}`,
        severity: "blocker",
        headline: `${compared.terms.lender}'s terms do not price like a real offer.`,
        detail: `${warning} Check the terms as received before comparing them against anything.`,
        evidence: [`${compared.terms.lender}: total cost ${gbp(compared.cost.total)} on ${gbp(compared.cost.facility)}`],
        assumptions: [],
        confidence: "recorded",
        capability: "compare",
        action: { effect: "record-selection", label: "Record the offer selected" },
      }),
    );
  }

  return out;
};

/** True once a person has accepted a Terms Agent proposal on this deal. */
export function termsSelected(decisions: readonly AgentDecision[]): boolean {
  return decisions.some((d) => d.agentId === "terms" && d.decision === "accepted");
}

const dueDiligenceObserver: Observer = (c) => {
  const agent = agentById("due-diligence");

  if (!termsSelected(c.decisions)) {
    return "No offer has been selected. Conditions are the conditions of a particular offer, so the plan waits for one.";
  }

  const out: AgentProposal[] = [];

  if (c.milestones.length === 0) {
    out.push(
      propose(agent, {
        key: "adopt-plan",
        severity: "action",
        headline: `Adopt the standard conditions plan: ${STANDARD_MILESTONES.length} conditions.`,
        detail:
          "Every condition starts not started. Nothing here marks anything satisfied — evidence is uploaded " +
          "and signed off by somebody other than whoever produced it, which is the control that stops a " +
          "condition being cleared by the person it was meant to test.",
        evidence: [`Standard plan: ${STANDARD_MILESTONES.map((m) => m.label).join(", ")}`],
        assumptions: ["The standard plan is the common English purchase. Add or remove conditions for this deal."],
        confidence: "recorded",
        capability: "propose-task",
        action: { effect: "adopt-conditions-plan", label: "Adopt the plan" },
      }),
    );
    return out;
  }

  const close = c.close;
  if (close === undefined) return out;

  for (const blocker of close.blockers) {
    out.push(
      propose(agent, {
        key: `chase:${blocker.milestone.key}`,
        severity: blocker.severity === "red" ? "blocker" : "action",
        headline: `${blocker.milestone.label} — chase ${blocker.milestone.owner.replace(/-/g, " ")}.`,
        detail: `${blocker.message} ${blocker.action} It holds up ${blocker.downstreamCount} further condition${blocker.downstreamCount === 1 ? "" : "s"}.`,
        evidence: [
          `Condition ${blocker.milestone.key}: ${blocker.milestone.status}`,
          `Close score ${close.closeScore}/100`,
        ],
        assumptions: ["Typical durations, not this firm's actual turnaround."],
        confidence: "recorded",
        capability: "draft",
        action: { effect: "record-review", label: "Record the chase" },
      }),
    );
  }

  return out;
};

/** A condition whose evidence lapses within this many days is worth raising. */
export const EXPIRY_WARNING_DAYS = 14;

const completionObserver: Observer = (c) => {
  const agent = agentById("completion");
  const close = c.close;
  if (close === undefined) {
    return "No conditions plan has been adopted, so there is no critical path to forecast against.";
  }

  const out: AgentProposal[] = [];
  const expiring = c.milestones.filter(
    (m) => m.status === "expiring" || (m.expiresInDays !== undefined && m.expiresInDays <= EXPIRY_WARNING_DAYS),
  );

  for (const milestone of expiring) {
    out.push(
      propose(agent, {
        key: `expiring:${milestone.key}`,
        severity: "blocker",
        headline: `${milestone.label} expires${milestone.expiresInDays !== undefined ? ` in ${milestone.expiresInDays} days` : " shortly"}.`,
        detail:
          `The critical path is ${close.criticalPathDays} days. ` +
          (milestone.expiresInDays !== undefined && milestone.expiresInDays < close.criticalPathDays
            ? "It expires before completion can be reached on current timings, so it will have to be renewed rather than raced."
            : "It clears the critical path, but only just. Renew it if anything slips.") +
          (milestone.note !== undefined ? ` ${milestone.note}` : ""),
        evidence: [
          `Condition ${milestone.key}: expires in ${milestone.expiresInDays ?? "?"} days`,
          `Critical path ${close.criticalPathDays} days`,
        ],
        assumptions: ["Typical durations for each remaining step."],
        confidence: "recorded",
        capability: "forecast",
        action: { effect: "record-review", label: "Acknowledge" },
      }),
    );
  }

  if (close.blockers.some((b) => b.severity === "red")) {
    out.push(
      propose(agent, {
        key: "forecast",
        severity: "action",
        headline: `Close score ${close.closeScore}/100, completion probability ${close.completionProbability}%.`,
        detail: `${close.summary} Critical path ${close.criticalPathDays} days. ${close.nextActions.join(" ")}`,
        evidence: [
          `Close report: ${close.sections.map((s) => `${s.label} ${s.percent}%`).join(", ")}`,
        ],
        assumptions: [
          "A forecast from typical durations. It is a planning aid, not a date anybody may be held to.",
        ],
        confidence: "recorded",
        capability: "forecast",
        action: { effect: "record-review", label: "Acknowledge" },
      }),
    );
  }

  return out;
};

const exitWatchObserver: Observer = (c) => {
  const agent = agentById("exit-watch");
  if (c.status !== "funded" && c.status !== "completed") {
    return `The deal is "${c.status}". Covenants and maturity are watched once money is drawn.`;
  }

  const out: AgentProposal[] = [];
  const appraisal = c.briefing.scored.appraisal;

  const dscr = c.metrics.metrics.find((m) => m.key === "refinance-dscr");
  if (dscr?.bps !== undefined && dscr.bps < REFINANCE_DSCR_COVENANT.level) {
    out.push(
      propose(agent, {
        key: "dscr-covenant",
        severity: "blocker",
        headline: `Refinance cover is ${percent(dscr.bps)} of the debt service, below the ${percent(REFINANCE_DSCR_COVENANT.level)} a term lender wants.`,
        detail:
          "The exit depends on a refinance the rent will not support. A deal can pass every leverage test " +
          "and still fail here, and it fails at the point where the bridge matures — which is the worst " +
          "possible moment to discover it. Raise the rent, reduce the advance, or plan the sale exit now.",
        evidence: [
          `${dscr.label}: ${percent(dscr.bps)} against ${dscr.against}`,
          `Covenant ${percent(REFINANCE_DSCR_COVENANT.level)} as at ${REFINANCE_DSCR_COVENANT.asOf}`,
        ],
        assumptions: ["Net rent as modelled, at the rate currently in the finance terms."],
        confidence: c.modelled ? "modelled" : "recorded",
        capability: "alert",
        action: { effect: "record-review", label: "Acknowledge" },
      }),
    );
  }

  if (!c.metrics.exitRepaysDebt) {
    out.push(
      propose(agent, {
        key: "exit-headroom",
        severity: "blocker",
        headline: "The exit does not repay the debt.",
        detail: `${c.metrics.summary} There is no version of this that improves by waiting.`,
        evidence: [`Funding metrics ${c.metrics.formulaVersion}`],
        assumptions: [],
        confidence: c.modelled ? "modelled" : "recorded",
        capability: "alert",
        action: { effect: "record-review", label: "Acknowledge" },
      }),
    );
  }

  const term = c.borrowing.cost.termMonths;
  if (appraisal.inputs.holdMonths >= term) {
    out.push(
      propose(agent, {
        key: "maturity",
        severity: "action",
        headline: `The hold runs ${appraisal.inputs.holdMonths} months against a ${term}-month facility.`,
        detail:
          "The plan reaches maturity with the work still running. An extension is priced at the lender's " +
          "discretion and a default rate is priced at nobody's. Start the refinance or the sale early enough " +
          "that the facility is not the thing setting the deadline.",
        evidence: [`Facility term ${term} months`, `Modelled hold ${appraisal.inputs.holdMonths} months`],
        assumptions: ["Term as recorded in the finance terms."],
        confidence: c.modelled ? "modelled" : "recorded",
        capability: "alert",
        action: { effect: "record-review", label: "Acknowledge" },
      }),
    );
  }

  return out;
};

const OBSERVERS: Record<AgentId, Observer> = {
  intake: intakeObserver,
  structuring: structuringObserver,
  risk: riskObserver,
  matching: matchingObserver,
  memorandum: memorandumObserver,
  terms: termsObserver,
  "due-diligence": dueDiligenceObserver,
  completion: completionObserver,
  "exit-watch": exitWatchObserver,
};

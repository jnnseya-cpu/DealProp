import { describe, expect, it } from "vitest";
import { bps, fromMajor, pct } from "@shared/money";
import type {
  DealInputs,
  FinanceTerms,
  PropertyFacts,
  SellerProfile,
} from "@shared/domain/types";
import { appraise } from "@shared/domain/economics";
import { borrowingReport } from "@shared/domain/borrowing";
import { buildCloseReport, STANDARD_MILESTONES, type Milestone } from "@shared/domain/completion";
import { fundingMetrics } from "@shared/domain/fundingMetrics";
import { fundingReadiness, type FundingEvidence } from "@shared/domain/fundingReadiness";
import { classifyRoute, type BorrowerFacts } from "@shared/domain/regulatoryRoute";
import { matchFundingBox, rankMatches, type FundingBox } from "@shared/domain/matching";
import { compareRecordedOffers, type OfferTerms } from "@shared/domain/offers";
import { runDealDirector } from "@shared/domain/director";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import {
  AGENTS,
  AGENTS_VERSION,
  agentById,
  authoriseDecision,
  decisionFor,
  EFFECT_OWNERS,
  propose,
  runAgents,
  termsSelected,
  VALUATION_STALE_MONTHS,
  type AgentContext,
  type AgentDecision,
  type AgentId,
  type AgentRun,
} from "@shared/domain/agents";

/**
 * The nine agents of §12.
 *
 * The tests that matter here are not the ones proving an agent says something.
 * They are the ones proving it cannot do anything: that the writing effect
 * belongs to one agent, that a shared credential cannot sign anything off, and
 * that an agent goes quiet the moment protection blocks or the route is
 * unclassified — because those are the failures that would cost somebody money
 * rather than a rendering bug.
 */

const NOW = new Date("2026-08-31T10:00:00Z");

const finance: FinanceTerms = {
  ltvBps: pct(70),
  refurbAdvanceBps: pct(100),
  annualRateBps: pct(12),
  arrangementFeeBps: pct(2),
  exitFeeBps: pct(1),
  interestRolledUp: true,
  lenderCosts: fromMajor(1_500),
};

const property: PropertyFacts = {
  id: "t",
  jurisdiction: "GB-ENG",
  postcodeArea: "B23",
  locality: "Erdington",
  propertyType: "house",
  tenure: "freehold",
  bedrooms: 3,
  occupancy: "vacant",
  openMarketValue: fromMajor(280_000),
  valuationConfidence: bps(8_500),
  refurbishmentEstimate: fromMajor(25_000),
  postWorksValue: fromMajor(320_000),
  monthlyRent: fromMajor(1_400),
  knownIssues: [],
};

const seller: SellerProfile = {
  situation: "probate",
  priorities: ["speed"],
  targetDays: 30,
  screening: { hasIndependentLegalAdvice: true, hasReceivedIndependentValuation: true },
};

const inputs: DealInputs = {
  property,
  seller,
  purchasePrice: fromMajor(225_000),
  buyerOwnsOtherProperty: true,
  buyerIsCompany: true,
  buyerIsNonResident: false,
  holdMonths: 9,
  structure: "bridging-refurb-refinance",
  finance,
  exit: "sell",
};

const businessFacts: BorrowerFacts = {
  legalForm: "company",
  businessPurposeDeclared: true,
  businessPurposeEvidenced: true,
  securityIncludesOwnerOccupiedDwelling: false,
  consumerBuyToLetIndicators: false,
  borrowerJurisdiction: "GB",
  assetJurisdiction: "GB",
};

const fundingBox: FundingBox = {
  id: "fb-1",
  funderName: "Example Bridging",
  kind: "bridging-lender",
  jurisdictions: ["GB-ENG"],
  localities: [],
  capitalAvailable: fromMajor(5_000_000),
  minTicket: fromMajor(50_000),
  maxTicket: fromMajor(1_000_000),
  propertyTypes: ["house"],
  maxLtvBps: pct(75),
  minTermMonths: 3,
  maxTermMonths: 24,
  acceptsRefurbishment: true,
  acceptsDevelopment: false,
  requiresFirstCharge: true,
  minBorrowerCompletedDeals: 0,
  requiredReturnBps: pct(10),
  personalGuaranteeRequired: true,
  active: true,
};

const offer: OfferTerms = {
  id: "off-1",
  lender: "Example Bridging",
  annualRateBps: pct(11),
  arrangementFeeBps: pct(2),
  brokerFeeBps: pct(1),
  exitFeeBps: pct(1),
  ltvBps: pct(70),
  lenderCosts: fromMajor(1_500),
  interestRolledUp: true,
  termMonths: 12,
  confidence: "credit-backed",
};

interface Options {
  readonly inputs?: DealInputs;
  readonly status?: AgentContext["status"];
  readonly evidence?: FundingEvidence;
  readonly borrowerFacts?: BorrowerFacts;
  readonly offers?: readonly OfferTerms[];
  readonly boxes?: readonly FundingBox[];
  readonly milestones?: readonly Milestone[];
  readonly decisions?: readonly AgentDecision[];
  readonly now?: Date;
}

/**
 * The same assembly the service does, without a store.
 *
 * Deliberately runs the real engines rather than stubbing them: an agent that
 * agrees with a fake appraisal proves nothing, and the whole claim being made
 * is that these figures come from the engines everything else reads.
 */
function context(options: Options = {}): AgentContext {
  const base = options.inputs ?? inputs;
  const working = toWorkingDeal(base);
  const briefing = runDealDirector(working.inputs);
  const appraisal = briefing.scored.appraisal;
  const evidence = options.evidence ?? {};
  const offers = options.offers ?? [];
  const milestones = options.milestones ?? [];
  const facts = options.borrowerFacts;

  const route =
    facts !== undefined
      ? classifyRoute(facts, "unregulated-business-lender", {
          regulatedMortgageIntroductions: false,
          creditBroking: true,
          promotionApprover: false,
        })
      : undefined;

  return {
    dealId: "deal-1",
    reference: "LODE-0001",
    status: options.status ?? "new",
    modelled: working.modelled,
    briefing,
    readiness: fundingReadiness(appraisal, evidence, route),
    metrics: fundingMetrics(appraisal, evidence.committedCash),
    borrowing: borrowingReport(appraisal),
    ...(route !== undefined ? { route } : {}),
    ...(facts !== undefined ? { borrowerFacts: facts } : {}),
    evidence,
    offers,
    comparison: compareRecordedOffers(working.inputs, offers),
    funderMatches: rankMatches(
      (options.boxes ?? [fundingBox]).map((b) =>
        matchFundingBox(b, briefing.scored, 3),
      ),
    ),
    milestones,
    ...(milestones.length > 0 ? { close: buildCloseReport(milestones) } : {}),
    decisions: options.decisions ?? [],
    now: options.now ?? NOW,
  };
}

function proposals(run: AgentRun, agentId: AgentId) {
  return run.proposals.filter((p) => p.agentId === agentId);
}

function dormant(run: AgentRun, agentId: AgentId): string | undefined {
  return run.outcomes.find((o) => o.agent.id === agentId)?.dormantReason;
}

function decision(overrides: Partial<AgentDecision> = {}): AgentDecision {
  return {
    id: "dec-1",
    dealId: "deal-1",
    agentId: "terms",
    proposalKey: "terms:cheapest:off-1",
    decision: "accepted",
    byAccountId: "acc-1",
    byName: "Jo Bloggs",
    note: "Cheapest in total and the advance covers the gap.",
    at: "2026-08-30T09:00:00.000Z",
    proposalHeadline: "Example Bridging is cheapest in total",
    effect: "record-selection",
    ...overrides,
  };
}

/* ------------------------------------------------------------- catalogue */

describe("the catalogue", () => {
  it("is the nine agents of the specification, each with a human control", () => {
    expect(AGENTS).toHaveLength(9);
    expect(AGENTS.map((a) => a.id)).toEqual([
      "intake",
      "structuring",
      "risk",
      "matching",
      "memorandum",
      "terms",
      "due-diligence",
      "completion",
      "exit-watch",
    ]);
    for (const agent of AGENTS) {
      expect(agent.humanControl.length).toBeGreaterThan(0);
      expect(agent.capabilities.length).toBeGreaterThan(0);
    }
  });

  it("names only real agents as the owner of an effect", () => {
    const ids = new Set(AGENTS.map((a) => a.id));
    for (const owners of Object.values(EFFECT_OWNERS)) {
      expect(owners.length).toBeGreaterThan(0);
      for (const owner of owners) expect(ids.has(owner)).toBe(true);
    }
  });
});

/* -------------------------------------------------------- what they cannot do */

describe("what an agent may not do", () => {
  const draft = {
    key: "k",
    severity: "action" as const,
    headline: "h",
    detail: "d",
    evidence: [],
    assumptions: [],
    confidence: "recorded" as const,
  };

  it("refuses output outside the agent's declared capabilities", () => {
    expect(() =>
      propose(agentById("risk"), {
        ...draft,
        capability: "draft",
        action: { effect: "record-review", label: "l" },
      }),
    ).toThrow(/may not "draft"/);
  });

  it("lets only the Due-Diligence Agent write a conditions plan", () => {
    expect(EFFECT_OWNERS["adopt-conditions-plan"]).toEqual(["due-diligence"]);
    for (const agent of AGENTS) {
      if (agent.id === "due-diligence") continue;
      expect(() =>
        propose(agent, {
          ...draft,
          capability: agent.capabilities[0] ?? "alert",
          action: { effect: "adopt-conditions-plan", label: "l" },
        }),
      ).toThrow(/may not produce the effect/);
    }
  });

  it("never produces an effect outside the closed set, on any deal", () => {
    const permitted = new Set(Object.keys(EFFECT_OWNERS));
    const runs = [
      runAgents(context()),
      runAgents(context({ status: "funded", borrowerFacts: businessFacts, offers: [offer] })),
      runAgents(
        context({
          status: "completed",
          offers: [offer],
          decisions: [decision()],
          milestones: STANDARD_MILESTONES.map((m) => ({ ...m, status: "not-started" as const })),
        }),
      ),
    ];
    const seen = runs.flatMap((r) => r.proposals);
    expect(seen.length).toBeGreaterThan(0);
    for (const proposal of seen) expect(permitted.has(proposal.action.effect)).toBe(true);
  });

  it("§19.9 — cannot accept or decline a borrower: the verdict is unchanged by running", () => {
    const c = context();
    const before = c.briefing.verdict;
    runAgents(c);
    expect(c.briefing.verdict).toBe(before);
    expect(runDealDirector(toWorkingDeal(inputs).inputs).verdict).toBe(before);
  });
});

/* ------------------------------------------------------------- decisions */

describe("who may decide", () => {
  it("refuses the shared operator password — a sign-off nobody made is not a sign-off", () => {
    const result = authoriseDecision({ kind: "shared-operator" }, "Looks fine.");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/named person/);
  });

  it("refuses a decision with no reason", () => {
    const result = authoriseDecision(
      { kind: "account", id: "a", name: "Jo", email: "jo@example.com" },
      "   ",
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Say why/);
  });

  it("accepts a named person with a reason", () => {
    const result = authoriseDecision(
      { kind: "account", id: "a", name: "Jo Bloggs", email: "jo@example.com" },
      "Checked the register.",
    );
    expect(result.ok).toBe(true);
    expect(result.reason).toContain("Jo Bloggs");
  });

  it("reads the most recent decision on a proposal, not the first", () => {
    const first = decision({ id: "d1", decision: "dismissed", at: "2026-08-01T00:00:00.000Z" });
    const second = decision({ id: "d2", decision: "accepted", at: "2026-08-20T00:00:00.000Z" });
    expect(decisionFor([first, second], first.proposalKey)?.id).toBe("d2");
    expect(decisionFor([first, second], "nothing:here")).toBeUndefined();
  });
});

/* ---------------------------------------------------------- Intake Agent */

describe("Intake Agent", () => {
  it("§19.5 — a valuation that disagrees with intake is a blocker naming both figures", () => {
    const run = runAgents(
      context({
        evidence: {
          valuationAmount: fromMajor(240_000),
          valuerFirm: "Example Surveyors LLP",
          valuationDate: "2026-08-20",
        },
      }),
    );
    const conflict = proposals(run, "intake").find((p) => p.key === "intake:valuation-conflict");
    expect(conflict).toBeDefined();
    expect(conflict?.severity).toBe("blocker");
    expect(conflict?.evidence.join(" ")).toContain("280,000");
    expect(conflict?.evidence.join(" ")).toContain("240,000");
    expect(conflict?.detail).toContain("Example Surveyors LLP");
  });

  it("treats a valuation inside tolerance as the same number measured twice", () => {
    const run = runAgents(
      context({ evidence: { valuationAmount: fromMajor(276_000), valuationDate: "2026-08-20" } }),
    );
    expect(proposals(run, "intake").map((p) => p.key)).not.toContain("intake:valuation-conflict");
  });

  it("raises a valuation older than the stale window", () => {
    const run = runAgents(context({ evidence: { valuationDate: "2026-01-04" } }));
    const stale = proposals(run, "intake").find((p) => p.key === "intake:valuation-stale");
    expect(stale).toBeDefined();
    expect(stale?.headline).toMatch(/months old/);
    expect(VALUATION_STALE_MONTHS).toBe(3);
  });

  it("treats expired documents as absent evidence", () => {
    const run = runAgents(context({ evidence: { expiredDocuments: 2 } }));
    const expired = proposals(run, "intake").find((p) => p.key === "intake:expired-documents");
    expect(expired?.severity).toBe("blocker");
  });

  it("names a buyer recorded one way and modelled another", () => {
    const run = runAgents(
      context({ borrowerFacts: { ...businessFacts, legalForm: "individual" } }),
    );
    const clash = proposals(run, "intake").find((p) => p.key === "intake:buyer-form-conflict");
    expect(clash?.severity).toBe("blocker");
    expect(clash?.evidence).toContain("Borrower facts: legalForm = individual");
  });

  it("names a jurisdiction recorded against a property in another", () => {
    const run = runAgents(
      context({ borrowerFacts: { ...businessFacts, assetJurisdiction: "US" } }),
    );
    const clash = proposals(run, "intake").find((p) => p.key === "intake:jurisdiction-conflict");
    expect(clash?.severity).toBe("blocker");
    expect(clash?.detail).toMatch(/wrong law/);
  });

  it("says plainly when the price was modelled rather than agreed", () => {
    const unpriced: DealInputs = {
      ...inputs,
      purchasePrice: property.openMarketValue,
      finance: { ...finance, ltvBps: bps(0) },
    };
    const run = runAgents(context({ inputs: unpriced }));
    const modelled = proposals(run, "intake").find((p) => p.key === "intake:price-modelled");
    expect(modelled).toBeDefined();
    expect(modelled?.confidence).toBe("modelled");
  });
});

/* --------------------------------------------------------- Matching Agent */

describe("Matching Agent", () => {
  it("goes quiet while Seller Protection blocks the deal", () => {
    const blocked: DealInputs = {
      ...inputs,
      seller: {
        ...seller,
        screening: {
          hasIndependentLegalAdvice: false,
          hasReceivedIndependentValuation: false,
          reportsHealthOrCapacityConcern: true,
        },
      },
    };
    const run = runAgents(context({ inputs: blocked, borrowerFacts: businessFacts }));
    expect(proposals(run, "matching")).toHaveLength(0);
    expect(dormant(run, "matching")).toMatch(/Seller Protection/);
  });

  it("goes quiet while the transaction is unclassified", () => {
    const run = runAgents(context());
    expect(proposals(run, "matching")).toHaveLength(0);
    expect(dormant(run, "matching")).toMatch(/never to permitted/);
  });

  it("goes quiet where the route forbids an introduction", () => {
    const run = runAgents(
      context({
        borrowerFacts: {
          ...businessFacts,
          legalForm: "individual",
          businessPurposeDeclared: false,
          businessPurposeEvidenced: false,
          securityIncludesOwnerOccupiedDwelling: true,
        },
      }),
    );
    expect(proposals(run, "matching")).toHaveLength(0);
    expect(dormant(run, "matching")).toMatch(/No introduction may be made/);
  });

  it("ranks eligible funders once the route permits it, and calls it a proposal", () => {
    const run = runAgents(context({ borrowerFacts: businessFacts }));
    const ranked = proposals(run, "matching");
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]?.action.effect).toBe("record-sign-off");
    expect(ranked[0]?.detail).toMatch(/Ranking is not permission/);
  });
});

/* ------------------------------------------------------- Memorandum Agent */

describe("Memorandum Agent", () => {
  it("will not draw a memorandum from an incomplete pack", () => {
    const run = runAgents(context());
    expect(proposals(run, "memorandum")).toHaveLength(0);
    expect(dormant(run, "memorandum")).toMatch(/scores \d+\/100/);
  });

  it("offers sign-off once the pack is fundable", () => {
    const run = runAgents(context({ evidence: fullEvidence(), borrowerFacts: businessFacts }));
    const memo = proposals(run, "memorandum");
    expect(memo).toHaveLength(1);
    expect(memo[0]?.action.effect).toBe("record-sign-off");
  });
});

function fullEvidence(): FundingEvidence {
  return {
    titleNumber: "WM123456",
    tenureConfirmed: true,
    legalPackReviewed: true,
    searchesOrdered: true,
    titleDefectsResolved: true,
    independentValuation: true,
    valuationDate: "2026-08-20",
    valuerFirm: "Example Surveyors LLP",
    comparablesRecorded: true,
    planningStatus: "not-required",
    borrowerIdentityVerified: true,
    sourceOfFundsEvidenced: true,
    trackRecordRecorded: true,
    adverseCreditDeclared: false,
    committedCash: fromMajor(120_000),
    scheduleOfWorks: true,
    costPlanFromQs: true,
    contractorAppointed: true,
    programmeAgreed: true,
    exitEvidence: true,
    backupExitRecorded: true,
    solicitorInstructed: true,
    expiredDocuments: 0,
  };
}

/* ------------------------------------------------------------ Terms Agent */

describe("Terms Agent", () => {
  it("has nothing to say until an offer is recorded", () => {
    const run = runAgents(context());
    expect(proposals(run, "terms")).toHaveLength(0);
    expect(dormant(run, "terms")).toMatch(/at least three/);
  });

  it("compares on total cost and refuses to accept anything", () => {
    const dearer: OfferTerms = { ...offer, id: "off-2", lender: "Dearer Ltd", annualRateBps: pct(15) };
    const run = runAgents(context({ offers: [offer, dearer] }));
    const compared = proposals(run, "terms").find((p) => p.key.startsWith("terms:cheapest"));
    expect(compared?.headline).toContain("Example Bridging");
    expect(compared?.action.effect).toBe("record-selection");
    expect(compared?.detail).toMatch(/Nothing here accepts anything/);
  });

  it("flags terms that do not price like a real offer", () => {
    const absurd: OfferTerms = { ...offer, id: "off-3", lender: "Too Good Ltd", annualRateBps: bps(10), arrangementFeeBps: bps(0), exitFeeBps: bps(0), brokerFeeBps: bps(0), lenderCosts: fromMajor(0) };
    const run = runAgents(context({ offers: [absurd] }));
    expect(proposals(run, "terms").some((p) => p.key.startsWith("terms:mispriced"))).toBe(true);
  });
});

/* ----------------------------------------------------- Due-Diligence Agent */

describe("Due-Diligence Agent", () => {
  it("waits for an offer to be selected by a person", () => {
    const run = runAgents(context({ offers: [offer] }));
    expect(proposals(run, "due-diligence")).toHaveLength(0);
    expect(dormant(run, "due-diligence")).toMatch(/No offer has been selected/);
    expect(termsSelected([])).toBe(false);
  });

  it("proposes the standard plan once terms are selected, at not-started", () => {
    const run = runAgents(context({ offers: [offer], decisions: [decision()] }));
    const plan = proposals(run, "due-diligence").find((p) => p.key === "due-diligence:adopt-plan");
    expect(plan?.action.effect).toBe("adopt-conditions-plan");
    expect(plan?.detail).toMatch(/Nothing here marks anything satisfied/);
  });

  it("chases whoever is holding a condition up, once a plan exists", () => {
    const milestones: Milestone[] = STANDARD_MILESTONES.map((m) => ({
      ...m,
      status: m.key === "searches" ? ("blocked" as const) : ("complete" as const),
    }));
    const run = runAgents(context({ offers: [offer], decisions: [decision()], milestones }));
    const chase = proposals(run, "due-diligence").find((p) => p.key === "due-diligence:chase:searches");
    expect(chase).toBeDefined();
    expect(chase?.headline).toContain("buyer solicitor");
  });
});

/* ------------------------------------------------------- Completion Agent */

describe("Completion Agent", () => {
  it("has no critical path to forecast against with no plan", () => {
    const run = runAgents(context());
    expect(dormant(run, "completion")).toMatch(/no critical path/);
  });

  it("raises evidence that expires before completion can be reached", () => {
    const milestones: Milestone[] = STANDARD_MILESTONES.map((m) => ({
      ...m,
      status: "not-started" as const,
      ...(m.key === "valuation" ? { expiresInDays: 5 } : {}),
    }));
    const run = runAgents(context({ milestones }));
    const expiring = proposals(run, "completion").find(
      (p) => p.key === "completion:expiring:valuation",
    );
    expect(expiring?.severity).toBe("blocker");
    expect(expiring?.detail).toMatch(/renewed rather than raced/);
  });
});

/* -------------------------------------------------------- Exit Watch Agent */

describe("Exit Watch Agent", () => {
  it("watches nothing until money is drawn", () => {
    const run = runAgents(context({ status: "qualified" }));
    expect(proposals(run, "exit-watch")).toHaveLength(0);
    expect(dormant(run, "exit-watch")).toMatch(/once money is drawn/);
  });

  it("alerts on refinance cover below the covenant a term lender wants", () => {
    const refinancing: DealInputs = {
      ...inputs,
      exit: "refinance-and-hold",
      property: { ...property, monthlyRent: fromMajor(600) },
    };
    const run = runAgents(context({ inputs: refinancing, status: "funded" }));
    const alert = proposals(run, "exit-watch").find((p) => p.key === "exit-watch:dscr-covenant");
    expect(alert?.severity).toBe("blocker");
    expect(alert?.action.effect).toBe("record-review");
  });

  it("alerts when the hold outruns the facility", () => {
    const long: DealInputs = { ...inputs, holdMonths: 18 };
    const run = runAgents(context({ inputs: long, status: "funded" }));
    const maturity = proposals(run, "exit-watch").find((p) => p.key === "exit-watch:maturity");
    expect(maturity?.headline).toMatch(/18 months against a 18-month facility/);
  });
});

/* ------------------------------------------------------------- provenance */

describe("every proposal", () => {
  const run = runAgents(
    context({
      borrowerFacts: businessFacts,
      offers: [offer],
      evidence: { valuationAmount: fromMajor(240_000), expiredDocuments: 1 },
      decisions: [decision()],
      status: "funded",
    }),
  );

  it("carries where it came from, what it assumed and how it was produced", () => {
    expect(run.proposals.length).toBeGreaterThan(5);
    for (const proposal of run.proposals) {
      expect(proposal.evidence.length).toBeGreaterThan(0);
      expect(proposal.detail.length).toBeGreaterThan(40);
      expect(proposal.version).toBe(AGENTS_VERSION);
      expect(proposal.engine).toBe("deterministic");
      expect(["recorded", "modelled", "assumed"]).toContain(proposal.confidence);
      expect(proposal.humanControl).toBe(agentById(proposal.agentId).humanControl);
    }
  });

  it("keys proposals stably, so a decision survives the next run", () => {
    const again = runAgents(
      context({
        borrowerFacts: businessFacts,
        offers: [offer],
        evidence: { valuationAmount: fromMajor(240_000), expiredDocuments: 1 },
        decisions: [decision()],
        status: "funded",
        now: new Date("2026-09-04T08:00:00Z"),
      }),
    );
    expect(again.proposals.map((p) => p.key)).toEqual(run.proposals.map((p) => p.key));
  });

  it("puts blockers first and counts them", () => {
    const severities = run.proposals.map((p) => p.severity);
    expect(severities.indexOf("blocker")).toBe(0);
    expect(run.blockers).toBe(severities.filter((s) => s === "blocker").length);
  });

  it("says why every silent agent is silent", () => {
    for (const outcome of run.outcomes) {
      if (outcome.proposals.length === 0) {
        expect(outcome.dormantReason ?? "").not.toBe("");
      }
    }
  });
});

import { isZero, type Money } from "@shared/money";
import type { DealAppraisal } from "@shared/domain/types";
import { fundingMetrics, refinanceDscr } from "@shared/domain/fundingMetrics";
import type { RouteDecision } from "@shared/domain/regulatoryRoute";

/**
 * Is this deal ready to put in front of a funder?
 *
 * **Triage, not approval.** A high score means the pack will survive first
 * reading; it is not a credit decision and nothing here may be presented as
 * one. The value is in the component breakdown and the blockers — a sponsor
 * with a score of 54 needs to know which fifteen points are missing and why,
 * not the number.
 *
 * Scored against evidence recorded on the deal, never against the absence of a
 * problem. A title with nothing recorded about it scores zero, not full marks:
 * the most expensive way to find out a pack is incomplete is for a lender to
 * find out first, having already charged for a valuation.
 */

/**
 * Weights, summing to 100.
 *
 * They are deliberately not equal. Title and valuation carry the most because
 * they are what a lender verifies first and what most often kills a case after
 * money has been spent; exit carries as much because a deal that cannot repay
 * is not a funding problem at all.
 */
export const WEIGHTS = {
  legalTitle: 15,
  valuationSecurity: 15,
  planning: 10,
  borrowerKyc: 10,
  capitalStack: 15,
  costProgramme: 10,
  exit: 15,
  evidenceQuality: 10,
} as const;

export type ComponentKey = keyof typeof WEIGHTS;

/**
 * What has actually been recorded about a deal, as opposed to modelled.
 *
 * Every field is optional and absence is meaningful: nothing here is defaulted
 * to a value that would score points. The appraisal knows what a deal *would*
 * be worth; this knows what can be *proved*, and a funder only lends against
 * the second.
 */
export interface FundingEvidence {
  readonly titleNumber?: string;
  readonly tenureConfirmed?: boolean;
  readonly legalPackReviewed?: boolean;
  readonly searchesOrdered?: boolean;
  readonly titleDefectsResolved?: boolean;

  readonly independentValuation?: boolean;
  readonly valuationDate?: string;
  readonly valuerFirm?: string;
  readonly comparablesRecorded?: boolean;

  readonly planningStatus?: "not-required" | "granted" | "applied" | "pre-application" | "none";
  readonly planningReference?: string;

  readonly borrowerIdentityVerified?: boolean;
  readonly sourceOfFundsEvidenced?: boolean;
  readonly trackRecordRecorded?: boolean;
  readonly adverseCreditDeclared?: boolean;

  /** Cash committed with proof, in pence. Unevidenced cash is not cash. */
  readonly committedCash?: Money;
  readonly scheduleOfWorks?: boolean;
  readonly costPlanFromQs?: boolean;
  readonly contractorAppointed?: boolean;
  readonly programmeAgreed?: boolean;

  readonly exitEvidence?: boolean;
  readonly backupExitRecorded?: boolean;

  readonly solicitorInstructed?: boolean;
  /** Documents whose recorded expiry has passed. Stale evidence is not evidence. */
  readonly expiredDocuments?: number;
}

export interface ReadinessComponent {
  readonly key: ComponentKey;
  readonly label: string;
  readonly weight: number;
  readonly earned: number;
  /** What is missing, in the order it should be dealt with. */
  readonly missing: readonly string[];
  readonly reason: string;
}

export interface ReadinessReport {
  /** 0–100. Triage only. */
  readonly score: number;
  readonly band: "fundable-pack" | "needs-work" | "not-ready";
  readonly components: readonly ReadinessComponent[];
  /** Things that stop this going to a funder at all, whatever the score. */
  readonly blockers: readonly string[];
  readonly caveat: string;
}

/** Award part of a component's weight for each satisfied condition. */
function score(
  key: ComponentKey,
  label: string,
  checks: readonly { readonly ok: boolean; readonly missing: string }[],
  reason: string,
): ReadinessComponent {
  const weight = WEIGHTS[key];
  const satisfied = checks.filter((c) => c.ok).length;
  const missing = checks.filter((c) => !c.ok).map((c) => c.missing);
  return {
    key,
    label,
    weight,
    earned: checks.length === 0 ? weight : Math.round((satisfied / checks.length) * weight),
    missing,
    reason,
  };
}

export function fundingReadiness(
  appraisal: DealAppraisal,
  evidence: FundingEvidence = {},
  route?: RouteDecision,
): ReadinessReport {
  const metrics = fundingMetrics(appraisal, evidence.committedCash);
  const planning = evidence.planningStatus;
  const needsPlanning = planning !== undefined && planning !== "not-required";

  const components: ReadinessComponent[] = [
    score(
      "legalTitle",
      "Legal and title",
      [
        { ok: (evidence.titleNumber ?? "") !== "", missing: "Record the title number." },
        { ok: evidence.tenureConfirmed === true, missing: "Confirm tenure against the register." },
        { ok: evidence.legalPackReviewed === true, missing: "Have the legal pack reviewed by a solicitor." },
        { ok: evidence.searchesOrdered === true, missing: "Order searches." },
        {
          ok: evidence.titleDefectsResolved !== false,
          missing: "Resolve or price the recorded title defects — a lender will not take them on trust.",
        },
      ],
      "What a lender's solicitor checks first, and what most often stops a case after money has been spent.",
    ),

    score(
      "valuationSecurity",
      "Valuation and security",
      [
        { ok: evidence.independentValuation === true, missing: "Obtain an independent valuation." },
        { ok: (evidence.valuerFirm ?? "") !== "", missing: "Record which firm valued it." },
        { ok: (evidence.valuationDate ?? "") !== "", missing: "Record the valuation date — lenders will not rely on a stale figure." },
        { ok: evidence.comparablesRecorded === true, missing: "Record the comparable sales behind the value." },
      ],
      "A lender lends against a valuer's figure, not the sponsor's. An unevidenced value is the most common reason a pack is returned.",
    ),

    score(
      "planning",
      "Planning",
      needsPlanning
        ? [
            { ok: planning === "granted", missing: `Planning is ${planning}, not granted. Price the risk or wait.` },
            { ok: (evidence.planningReference ?? "") !== "", missing: "Record the application reference." },
          ]
        : [{ ok: planning === "not-required", missing: "State whether planning is required at all." }],
      needsPlanning
        ? "Where the value depends on consent, the consent is the asset."
        : "Recorded as not required, which still has to be stated rather than assumed.",
    ),

    score(
      "borrowerKyc",
      "Borrower and identity",
      [
        { ok: evidence.borrowerIdentityVerified === true, missing: "Verify the borrower's identity." },
        { ok: evidence.sourceOfFundsEvidenced === true, missing: "Evidence the source of the deposit funds." },
        { ok: evidence.trackRecordRecorded === true, missing: "Record the sponsor's track record on comparable projects." },
        { ok: evidence.adverseCreditDeclared !== undefined, missing: "Declare adverse credit either way — silence reads as concealment when it is found later." },
      ],
      "Every lender runs this and every one of them finds what was not disclosed. Disclosed adverse credit is priced; undisclosed adverse credit ends the case.",
    ),

    score(
      "capitalStack",
      "Capital stack",
      [
        { ok: isZero(gapOf(metrics)), missing: "Close the funding gap, or record where the remaining cash is coming from." },
        { ok: (evidence.committedCash ?? 0) > 0, missing: "Record committed cash with proof of funds." },
        { ok: metrics.exitRepaysDebt, missing: "The exit does not repay the facility. Restructure before approaching anyone." },
      ],
      "Sources against uses. A stack that only balances if the sponsor finds money nobody has seen is not a stack.",
    ),

    score(
      "costProgramme",
      "Costs and programme",
      [
        { ok: evidence.scheduleOfWorks === true, missing: "Produce a schedule of works." },
        { ok: evidence.costPlanFromQs === true, missing: "Have costs checked by a quantity surveyor." },
        { ok: evidence.contractorAppointed === true, missing: "Appoint the contractor, or name who is delivering." },
        { ok: evidence.programmeAgreed === true, missing: "Agree the programme against the exit date." },
      ],
      "A works budget the sponsor wrote is an estimate. A lender funding works wants one somebody independent has checked.",
    ),

    score(
      "exit",
      "Exit",
      [
        { ok: metrics.exitRepaysDebt, missing: "The modelled exit does not clear the debt." },
        { ok: evidence.exitEvidence === true, missing: "Evidence the exit — comparable sales, or a lender's appetite for the refinance." },
        { ok: evidence.backupExitRecorded === true, missing: "Record a backup exit. The first question a credit committee asks is what happens if the first one fails." },
        {
          ok: dscrAcceptable(appraisal),
          missing: "The refinance does not service its own interest at the modelled rent, so the refinance exit will not be offered.",
        },
      ],
      "The exit is what repays the lender. Everything else is detail by comparison.",
    ),

    score(
      "evidenceQuality",
      "Evidence quality",
      [
        { ok: evidence.solicitorInstructed === true, missing: "Instruct a solicitor." },
        { ok: (evidence.expiredDocuments ?? 0) === 0, missing: `${evidence.expiredDocuments ?? 0} document(s) have expired. Stale evidence is not evidence.` },
      ],
      "A pack of current, consistent documents is read. A pack that contradicts itself generates questions instead of terms.",
    ),
  ];

  const total = components.reduce((sum, c) => sum + c.earned, 0);

  const blockers: string[] = [];
  if (!metrics.exitRepaysDebt) {
    blockers.push(
      "The modelled exit does not repay the senior facility. This is not something to shop around for; the deal does not work as structured.",
    );
  }
  if (route !== undefined && !route.mayIntroduce) {
    blockers.push(
      `Regulatory route ${route.route}: ${route.reason} No introduction may be made until this is cleared.`,
    );
  }
  if ((evidence.expiredDocuments ?? 0) > 0) {
    blockers.push(`${evidence.expiredDocuments} document(s) in the pack have expired.`);
  }

  return {
    score: total,
    band: total >= 75 ? "fundable-pack" : total >= 45 ? "needs-work" : "not-ready",
    components,
    blockers,
    caveat:
      "Triage, not approval. This measures whether the pack will survive a funder's first reading. It is not a credit decision, it does not bind any lender, and no figure in it is advice.",
  };
}

function gapOf(metrics: ReturnType<typeof fundingMetrics>): Money {
  const gap = metrics.metrics.find((m) => m.key === "funding-gap");
  return (gap?.amount ?? 0) as Money;
}

/**
 * A refinance exit that cannot service its own interest is not an exit.
 *
 * Only applied where the deal actually refinances; a sale exit has no ongoing
 * debt service and must not be penalised for the absence of a ratio.
 */
function dscrAcceptable(appraisal: DealAppraisal): boolean {
  const dscr = refinanceDscr(appraisal);
  if (dscr === undefined) return true;
  return dscr >= 10_000;
}

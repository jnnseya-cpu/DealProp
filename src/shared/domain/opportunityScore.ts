import type { DealInputs } from "@shared/domain/types";
import { scoreDeal } from "@shared/domain/dealScore";
import type { FundingEvidence } from "@shared/domain/fundingReadiness";
import { saleIsConfirmed, type InventoryItem } from "@shared/domain/inventory";

/**
 * How good is this opportunity, and how much of that do we actually know?
 *
 * The Deal Score answers the first question and answers it well: margin after
 * tax, stress tolerance, seller protection, exit. What it cannot answer is the
 * second, and the second is what decides a ranking.
 *
 * A property with a large theoretical discount and an unclear title must rank
 * below a smaller-discount property that can complete in three weeks. That is
 * not a weighting preference, it is the difference between a number and a
 * transaction: the first deal is worth its discount multiplied by the
 * probability it happens, and nobody who ranks on discount alone is computing
 * the second half of that.
 *
 * So this is the Deal Score, discounted by what can be proved and by what
 * would stop it completing. Three consequences follow, and all three are
 * deliberate:
 *
 *  1. **Confidence caps the score.** An unevidenced 92 becomes a 55, and it
 *     ranks below an evidenced 70. Nothing else in the system can produce that
 *     ordering, and it is the whole point.
 *  2. **Evidence used and evidence missing are both published.** A buyer
 *     comparing two opportunities needs to know which one is uncertain and
 *     why, not which one has the larger number.
 *  3. **The calculation is dated.** A score is a statement about a moment. One
 *     computed against a title check that has since expired is a stale
 *     statement, and a reader cannot tell without the date.
 */

export const OPPORTUNITY_SCORE_VERSION = "opportunity-1";

export type Confidence = "high" | "medium" | "low";

/**
 * What each confidence level does to the score.
 *
 * A cap rather than a multiplier: a multiplier is a fudge factor that flatters
 * a strong deal and punishes a weak one by the same proportion, while what is
 * actually true is that no deal can be trusted above a certain point without
 * evidence, however good it looks.
 *
 * The low cap is 40 rather than something gentler, and the number is
 * load-bearing. It is what makes the specification's own example come out
 * right: a property with a large theoretical discount and an unchecked title
 * has to rank *below* a smaller-discount property that can complete, and a cap
 * of 55 does not achieve that — an unevidenced 62 still beats an evidenced 42,
 * which is exactly the ordering being complained about. Forty says the thing
 * that is actually true: an opportunity whose critical checks are missing
 * cannot be presented as better than average, however good the arithmetic
 * looks, because nobody yet knows whether the arithmetic applies to anything.
 */
export const CONFIDENCE_CAPS: Readonly<Record<Confidence, number>> = {
  high: 100,
  medium: 70,
  low: 40,
};

export interface EvidenceItem {
  readonly label: string;
  /** Why it matters, in a sentence a buyer can act on. */
  readonly why: string;
}

/**
 * What is checked, in the order it decides a transaction.
 *
 * Title first because it is what kills a deal latest and most expensively —
 * after the survey, after the valuation, after the buyer has spent money. A
 * discount cannot compensate for a title nobody can pass on.
 */
const CHECKS: readonly {
  readonly key: string;
  readonly label: string;
  readonly why: string;
  /** True where the deal cannot be relied on without it, whatever the score. */
  readonly critical: boolean;
  readonly held: (evidence: FundingEvidence, item: InventoryItem | undefined) => boolean;
}[] = [
  {
    key: "sale-confirmed",
    label: "Somebody with authority confirmed the sale",
    why: "Without it there is no transaction to be early to, however large the discount looks.",
    critical: true,
    held: (_e, item) => saleIsConfirmed(item),
  },
  {
    key: "title",
    label: "Title checked and clear",
    why: "Title is what kills a deal latest and most expensively — after the survey and the valuation, with the buyer's money already spent.",
    critical: true,
    held: (e) => e.titleNumber !== undefined && e.tenureConfirmed === true,
  },
  {
    key: "title-defects",
    label: "Title defects resolved",
    why: "A recorded defect nobody has cleared is a completion date nobody can promise.",
    critical: false,
    held: (e) => e.titleDefectsResolved === true,
  },
  {
    key: "searches",
    label: "Searches ordered",
    why: "Searches are the long pole in most conveyancing. Ordered early is weeks off the completion date.",
    critical: false,
    held: (e) => e.searchesOrdered === true,
  },
  {
    key: "valuation",
    label: "Independent valuation",
    why: "The discount is measured against a value. An unverified value makes the discount unverified too.",
    critical: true,
    held: (e) => e.independentValuation === true,
  },
  {
    key: "comparables",
    label: "Comparables recorded",
    why: "What the valuation is built on, and the only way a buyer can check it rather than take it.",
    critical: false,
    held: (e) => e.comparablesRecorded === true,
  },
  {
    key: "legal-pack",
    label: "Legal pack reviewed",
    why: "Everything a solicitor would find, found before an offer rather than after one.",
    critical: false,
    held: (e) => e.legalPackReviewed === true,
  },
  {
    key: "solicitor",
    label: "Conveyancer instructed",
    why: "The difference between a seller who intends to sell and a seller who has started.",
    critical: false,
    held: (e) => e.solicitorInstructed === true,
  },
  {
    key: "planning",
    label: "Planning position established",
    why: "A refurbishment plan that needs a consent nobody has applied for is a plan with an unknown date on it.",
    critical: false,
    held: (e) => e.planningStatus !== undefined && e.planningStatus !== "none",
  },
];

export interface OpportunityScore {
  /** 0–100, after the confidence cap. Never the raw deal score. */
  readonly score: number;
  /** What it would have been on the evidence being complete. */
  readonly uncappedScore: number;
  readonly confidence: Confidence;
  readonly confidenceReason: string;
  readonly evidenceUsed: readonly EvidenceItem[];
  readonly evidenceMissing: readonly EvidenceItem[];
  /** ISO-8601. A score is a statement about a moment. */
  readonly calculatedAt: string;
  /** Why it scores what it does, best first. */
  readonly reasons: readonly string[];
  /** What would stop it completing, worst first. */
  readonly risks: readonly string[];
  readonly version: string;
}

export interface OpportunityScoreInput {
  readonly inputs: DealInputs;
  readonly evidence?: FundingEvidence;
  readonly item?: InventoryItem;
  /** Documents whose recorded expiry has passed. Stale evidence is not evidence. */
  readonly now: Date;
}

/**
 * Confidence, from what is held rather than from how confident anybody feels.
 *
 * A missing critical check is low on its own: there is no amount of other
 * evidence that makes an unconfirmed sale or an unchecked title into a
 * knowable transaction.
 */
function confidenceFrom(
  held: readonly string[],
  missingCritical: readonly string[],
  total: number,
): { readonly level: Confidence; readonly reason: string } {
  if (missingCritical.length > 0) {
    return {
      level: "low",
      reason: `${missingCritical.length} of the checks that decide whether this can complete at all ${missingCritical.length === 1 ? "is" : "are"} missing. No amount of other evidence substitutes for ${missingCritical.join(", ").toLowerCase()}.`,
    };
  }
  const proportion = total === 0 ? 0 : held.length / total;
  if (proportion >= 0.8) {
    return {
      level: "high",
      reason: `${held.length} of ${total} checks hold, including every one that decides completion.`,
    };
  }
  if (proportion >= 0.5) {
    return {
      level: "medium",
      reason: `${held.length} of ${total} checks hold. The critical ones are covered; the rest would firm up the date rather than the price.`,
    };
  }
  return {
    level: "low",
    reason: `Only ${held.length} of ${total} checks hold. The deal may be as good as it looks, but almost nothing about it has been established.`,
  };
}

export function scoreOpportunity(input: OpportunityScoreInput): OpportunityScore {
  const evidence = input.evidence ?? {};
  const deal = scoreDeal(input.inputs);
  const uncapped = deal.breakdown.composite;

  const used: EvidenceItem[] = [];
  const missing: EvidenceItem[] = [];
  const missingCritical: string[] = [];

  for (const check of CHECKS) {
    if (check.held(evidence, input.item)) {
      used.push({ label: check.label, why: check.why });
      continue;
    }
    missing.push({ label: check.label, why: check.why });
    if (check.critical) missingCritical.push(check.label);
  }

  const confidence = confidenceFrom(
    used.map((u) => u.label),
    missingCritical,
    CHECKS.length,
  );
  const cap = CONFIDENCE_CAPS[confidence.level];
  const score = Math.min(uncapped, cap);

  // The principal reasons are the deal's own strongest components, said in the
  // engine's own words rather than restated here.
  const reasons = [...deal.breakdown.components]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((c) => `${c.label}: ${c.rationale}`);

  const risks: string[] = [];

  // Seller Protection first and always. A block is not a risk to be weighed
  // against a discount; it is the reason there is no opportunity here.
  if (deal.protection.blocked) {
    risks.push(
      `Seller Protection blocks this: ${deal.protection.flags.map((f) => f.detail).join(" ")} There is no position to take.`,
    );
  }
  for (const label of missingCritical) {
    risks.push(`${label} — not established. This is what makes the score uncertain rather than low.`);
  }
  if (score < uncapped) {
    risks.push(
      `Scored ${score} rather than ${uncapped}: confidence is ${confidence.level}, and a deal is worth its discount multiplied by the chance it happens.`,
    );
  }
  // Single-factor losses only. A compound loss needs several severe moves at
  // once and listing it beside a title defect would give the two equal weight,
  // which is the mistake the Red Team tiering exists to prevent.
  for (const loss of deal.redTeam.singleFactorLosses) {
    risks.push(`Loses money if ${loss.toLowerCase()} — one variable moving, not several.`);
  }
  if ((evidence.expiredDocuments ?? 0) > 0) {
    risks.push(
      `${String(evidence.expiredDocuments)} document${evidence.expiredDocuments === 1 ? " has" : "s have"} expired. Stale evidence is not evidence, and this score does not count it.`,
    );
  }

  return {
    score,
    uncappedScore: uncapped,
    confidence: confidence.level,
    confidenceReason: confidence.reason,
    evidenceUsed: used,
    evidenceMissing: missing,
    calculatedAt: input.now.toISOString(),
    reasons,
    risks,
    version: OPPORTUNITY_SCORE_VERSION,
  };
}

/**
 * Rank opportunities.
 *
 * By the capped score, so an unevidenced 92 sits below an evidenced 70 — the
 * ordering this file exists to produce. Ties break on confidence and then on
 * how much evidence is held, because between two equal scores the one somebody
 * has actually checked is the better opportunity.
 */
export function rankOpportunities<T extends { readonly score: OpportunityScore }>(
  items: readonly T[],
): readonly T[] {
  const rank: Readonly<Record<Confidence, number>> = { high: 3, medium: 2, low: 1 };
  return [...items].sort(
    (a, b) =>
      b.score.score - a.score.score ||
      rank[b.score.confidence] - rank[a.score.confidence] ||
      b.score.evidenceUsed.length - a.score.evidenceUsed.length,
  );
}

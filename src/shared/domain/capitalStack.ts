import { add, applyBps, bps, max, money, pct, ratioBps, sub, ZERO, type Bps, type Money } from "@shared/money";
import type { DealAppraisal } from "@shared/domain/types";

/**
 * Capital Stack AI.
 *
 * Assembles the money for a transaction from third parties so that a buyer
 * with no acquisition capital can still transact — provided they bring
 * something else of value.
 *
 * The honest framing this module enforces: the capital does not disappear.
 * Someone provides every pound, and they price it. A stack that leaves the
 * originator with £0 in is a stack where other people carry all the financial
 * risk, so the originator's share must be earned from what they contribute and
 * the deal must still clear each provider's required return. If it cannot, the
 * solver says so instead of inventing a structure.
 */

export type ContributionClass = "capital" | "deal" | "capability";

export type StackLayerKind =
  | "senior-debt"
  | "mezzanine"
  | "private-loan"
  | "jv-equity"
  | "seller-deferred"
  | "originator-cash";

export interface StackLayer {
  readonly kind: StackLayerKind;
  readonly label: string;
  readonly amount: Money;
  /** Annual cost of this layer, basis points. Equity layers use 0. */
  readonly annualCostBps: Bps;
  /** Share of residual profit, basis points. Debt layers use 0. */
  readonly profitShareBps: Bps;
  readonly priority: number;
  readonly note: string;
}

export interface CapitalStack {
  readonly layers: readonly StackLayer[];
  readonly totalRaised: Money;
  readonly requirement: Money;
  readonly shortfall: Money;
  readonly feasible: boolean;
  /** Cash the originator must personally provide. */
  readonly originatorCash: Money;
  /** Residual profit after every provider is paid their required return. */
  readonly residualProfit: Money;
  /** The originator's share of residual profit, basis points. */
  readonly originatorShareBps: Bps;
  readonly originatorProfit: Money;
  readonly warnings: readonly string[];
  readonly contributions: readonly ContributionClass[];
}

export interface StackPreferences {
  /** Cash the originator can actually provide. Zero is the headline case. */
  readonly originatorCashAvailable: Money;
  /** Maximum senior LTV a lender will advance against purchase price. */
  readonly maxSeniorLtvBps: Bps;
  /** Annual coupon a private lender expects. */
  readonly privateLoanRateBps: Bps;
  /** Profit share a JV equity partner expects for the money they put in. */
  readonly jvProfitShareBps: Bps;
  /** Whether the seller will defer part of the consideration. */
  readonly sellerWillDefer: boolean;
  /** Portion of price the seller would defer, basis points. */
  readonly sellerDeferralBps: Bps;
  /** What the originator brings besides money. */
  readonly originatorContributions: readonly ContributionClass[];
}

export const DEFAULT_PREFERENCES: StackPreferences = {
  originatorCashAvailable: ZERO,
  maxSeniorLtvBps: pct(70),
  privateLoanRateBps: pct(10),
  jvProfitShareBps: pct(50),
  sellerWillDefer: false,
  sellerDeferralBps: pct(0),
  originatorContributions: ["deal", "capability"],
};

/**
 * Minimum residual share an originator should retain for the deal to be worth
 * originating. Below this, the OS tells them the truth: they are working for
 * nothing and should renegotiate rather than proceed.
 */
const MIN_VIABLE_ORIGINATOR_SHARE_BPS = 1_000;

export function buildCapitalStack(
  appraisal: DealAppraisal,
  prefs: StackPreferences = DEFAULT_PREFERENCES,
): CapitalStack {
  const requirement = appraisal.costs.total;
  const warnings: string[] = [];
  const layers: StackLayer[] = [];

  let remaining = requirement;

  // --- Layer 1: the senior facility --------------------------------------
  // Taken from the appraisal rather than recomputed, so the stack and the
  // appraisal can never state different senior debt for the same deal. The
  // preference acts as a ceiling: a funder unwilling to go past its own LTV
  // limit constrains the facility even if the deal was modelled with more.
  const worksTranche = applyBps(
    appraisal.inputs.property.refurbishmentEstimate,
    appraisal.inputs.finance.refurbAdvanceBps,
  );
  // The advance against the purchase is the lower of what the deal assumed and
  // what this funder's mandate permits. The works tranche rides on top, since
  // an LTV limit is expressed against the purchase price, not the whole project.
  const effectiveLtvBps = bps(Math.min(prefs.maxSeniorLtvBps, appraisal.inputs.finance.ltvBps));
  const seniorCap = add(applyBps(appraisal.inputs.purchasePrice, effectiveLtvBps), worksTranche);
  const senior = money(Math.min(seniorCap, remaining));
  if (senior > 0) {
    layers.push({
      kind: "senior-debt",
      label: "Senior lender (first charge)",
      amount: senior,
      annualCostBps: appraisal.inputs.finance.annualRateBps,
      profitShareBps: bps(0),
      priority: 1,
      note:
        worksTranche > 0
          ? `First charge at ${(effectiveLtvBps / 100).toFixed(0)}% of purchase price plus a works tranche drawn in arrears. Repaid first on exit.`
          : `First charge at ${(effectiveLtvBps / 100).toFixed(0)}% of purchase price. Repaid first on exit.`,
    });
    remaining = sub(remaining, senior);
  }

  // --- Layer 2: seller deferral ------------------------------------------
  // Cheapest capital in the stack when available, because the seller is
  // usually pricing certainty rather than yield. Requires the seller to
  // genuinely understand the risk — enforced by protection.ts, not here.
  if (prefs.sellerWillDefer && prefs.sellerDeferralBps > 0 && remaining > 0) {
    const deferred = money(
      Math.min(applyBps(appraisal.inputs.purchasePrice, prefs.sellerDeferralBps), remaining),
    );
    if (deferred > 0) {
      layers.push({
        kind: "seller-deferred",
        label: "Seller deferred consideration",
        amount: deferred,
        annualCostBps: bps(0),
        profitShareBps: bps(0),
        priority: 3,
        note: "Part of the price paid later. The seller is an unsecured or second-charge creditor and must take independent legal advice.",
      });
      remaining = sub(remaining, deferred);
      warnings.push(
        "Seller deferral relies on the seller accepting payment risk. Do not model it as committed until it is documented and the seller's advice is evidenced.",
      );
    }
  }

  // --- Layer 3: originator's own cash ------------------------------------
  const originatorCash = money(Math.min(prefs.originatorCashAvailable, remaining));
  if (originatorCash > 0) {
    layers.push({
      kind: "originator-cash",
      label: "Deal originator cash",
      amount: originatorCash,
      annualCostBps: bps(0),
      profitShareBps: bps(0),
      priority: 5,
      note: "The originator's own money, at risk behind every other layer.",
    });
    remaining = sub(remaining, originatorCash);
  }

  // --- Layer 4: private loan for part of the gap -------------------------
  // Private debt is cheaper than equity, so it fills the gap first, but only
  // to the point where total debt stays within the finished asset's value.
  // Beyond that a lender is unsecured in substance and would not lend.
  const prudentDebtCeiling = applyBps(appraisal.exit.grossDevelopmentValue, pct(80));
  const debtSoFar = senior;
  const privateHeadroom = max(sub(prudentDebtCeiling, debtSoFar), ZERO);
  const privateLoan = money(Math.min(privateHeadroom, remaining));
  if (privateLoan > 0) {
    layers.push({
      kind: "private-loan",
      label: "Private lender (second charge)",
      amount: privateLoan,
      annualCostBps: prefs.privateLoanRateBps,
      profitShareBps: bps(0),
      priority: 2,
      note: `Fixed coupon at ${(prefs.privateLoanRateBps / 100).toFixed(1)}% annually. Ranks behind the senior lender.`,
    });
    remaining = sub(remaining, privateLoan);
  }

  // --- Layer 5: JV equity for whatever is left ---------------------------
  const jvEquity = max(remaining, ZERO);
  if (jvEquity > 0) {
    layers.push({
      kind: "jv-equity",
      label: "JV equity partner",
      amount: jvEquity,
      annualCostBps: bps(0),
      profitShareBps: prefs.jvProfitShareBps,
      priority: 4,
      note: `Takes ${(prefs.jvProfitShareBps / 100).toFixed(0)}% of residual profit in exchange for the last money in and the first loss.`,
    });
    remaining = ZERO;
  }

  const totalRaised = add(...layers.map((l) => l.amount));
  const shortfall = max(sub(requirement, totalRaised), ZERO);

  // --- Cost of the stack -------------------------------------------------
  // The base appraisal already charges senior interest, so only the layers it
  // does not know about are deducted again here.
  const months = appraisal.inputs.holdMonths;
  const privateInterest = money(
    Math.round((privateLoan * prefs.privateLoanRateBps * months) / (10_000 * 12)),
  );

  const profitAfterDebt = sub(appraisal.profit, privateInterest);
  const jvShare = jvEquity > 0 ? applyBps(max(profitAfterDebt, ZERO), prefs.jvProfitShareBps) : ZERO;
  const residualProfit = sub(profitAfterDebt, jvShare);

  const originatorShareBps = ratioBps(max(residualProfit, ZERO), max(appraisal.profit, money(1)));

  // --- Warnings the originator needs before they commit ------------------
  if (shortfall > 0) {
    warnings.push(
      `The stack is short by ${(shortfall / 100).toLocaleString()} of the total requirement. This deal cannot be funded on these assumptions.`,
    );
  }
  if (originatorCash === 0) {
    warnings.push(
      "The originator contributes no cash. Every provider in this stack is taking financial risk the originator is not, which is why they price it — this is not free money, and the originator's return must be earned from the deal, negotiation and execution they contribute.",
    );
  }
  if (residualProfit <= 0) {
    warnings.push(
      "After paying every capital provider their required return, nothing is left for the originator. Renegotiate the price or the profit shares before proceeding.",
    );
  } else if (originatorShareBps < MIN_VIABLE_ORIGINATOR_SHARE_BPS) {
    warnings.push(
      `The originator retains only ${(originatorShareBps / 100).toFixed(1)}% of profit. That is unlikely to justify the work and personal guarantees involved.`,
    );
  }
  if (senior > 0 && appraisal.inputs.finance.interestRolledUp) {
    warnings.push(
      "Senior interest is rolled up, so the debt grows every month the project overruns. Check the Red Team delay scenarios before relying on the exit date.",
    );
  }
  if (privateLoan > 0) {
    warnings.push(
      "Raising money from private individuals is a regulated activity in most jurisdictions. The financial promotion and investor categorisation requirements in the jurisdiction pack apply before anyone is approached.",
    );
  }

  const feasible = shortfall === 0 && residualProfit > 0;

  return {
    layers: layers.sort((a, b) => a.priority - b.priority),
    totalRaised,
    requirement,
    shortfall,
    feasible,
    originatorCash,
    residualProfit: max(residualProfit, money(residualProfit)),
    originatorShareBps,
    originatorProfit: residualProfit,
    warnings,
    contributions: prefs.originatorContributions,
  };
}

import { bps, money, ratioBps, ZERO } from "@/lib/money";
import type { ProfitTaxAssessment, ProfitTaxInput } from "./types";

/**
 * Profit tax estimators.
 *
 * These are estimates for deal-screening only. Property tax is fact-specific
 * and every assessment produced here is marked as requiring professional
 * review — the OS's job is to stop investors from appraising deals on a
 * pre-tax basis, not to replace an accountant.
 *
 * RATES ARE A SNAPSHOT AND MUST BE RE-VERIFIED EACH BUDGET.
 */

/** UK corporation tax main rate. */
const UK_CORP_MAIN_BPS = 2_500;
/** UK corporation tax small profits rate. */
const UK_CORP_SMALL_BPS = 1_900;
/** Profit below which the small profits rate applies (single company). */
const UK_SMALL_PROFITS_LIMIT = money(50_000 * 100);
/** Upper marginal limit for corporation tax. */
const UK_MARGINAL_LIMIT = money(250_000 * 100);

/** CGT higher rate on residential property for individuals. */
const UK_CGT_RESIDENTIAL_HIGHER_BPS = 2_400;
/** Income tax higher rate, applied to trading profit and rental income. */
const UK_INCOME_HIGHER_BPS = 4_000;

export function ukProfitTax(input: ProfitTaxInput): ProfitTaxAssessment {
  const { profitBeforeTax, buyerIsCompany, isTrading, rentalProfit } = input;
  const caveats: string[] = [
    "Estimate only. Reliefs, losses, allowances and the taxpayer's wider position are not modelled.",
    "Confirm with a qualified tax adviser before relying on this figure.",
  ];

  if (profitBeforeTax <= 0 && rentalProfit <= 0) {
    return {
      amount: ZERO,
      label: "No profit tax (no taxable profit)",
      effectiveRateBps: bps(0),
      basis: "The deal makes no profit in the base case, so no profit tax arises. Losses may be relievable.",
      requiresProfessionalReview: true,
      caveats,
    };
  }

  const taxable = money(Math.max(0, profitBeforeTax));

  if (buyerIsCompany) {
    // Marginal relief between the limits is approximated by interpolating the
    // effective rate; the exact fraction is not modelled because associated
    // companies and accounting periods change it materially.
    let rateBps: number;
    if (taxable <= UK_SMALL_PROFITS_LIMIT) {
      rateBps = UK_CORP_SMALL_BPS;
    } else if (taxable >= UK_MARGINAL_LIMIT) {
      rateBps = UK_CORP_MAIN_BPS;
    } else {
      const span = UK_MARGINAL_LIMIT - UK_SMALL_PROFITS_LIMIT;
      const progress = (taxable - UK_SMALL_PROFITS_LIMIT) / span;
      rateBps = Math.round(UK_CORP_SMALL_BPS + progress * (UK_CORP_MAIN_BPS - UK_CORP_SMALL_BPS));
    }
    caveats.push(
      "Corporation tax assumes a single company with no associated companies. Associated companies reduce the small profits limit.",
    );
    caveats.push(
      "Extracting profit from the company (dividends or salary) is a further tax event that is not modelled here.",
    );
    const amount = money(Math.round((taxable * rateBps) / 10_000));
    return {
      amount,
      label: "Corporation tax (estimated)",
      effectiveRateBps: bps(rateBps),
      basis: `Company purchase. Profit of ${fmt(taxable)} taxed at an estimated ${(rateBps / 100).toFixed(1)}% including marginal relief interpolation.`,
      requiresProfessionalReview: true,
      caveats,
    };
  }

  // Individual. Trading profit is income; investment gain is CGT. Which
  // applies is a question of fact, and getting it wrong changes the answer
  // by ~16 points, so both the assumption and its consequence are stated.
  if (isTrading) {
    caveats.push(
      "Buy-refurbish-sell by an individual is usually trading, taxed as income at up to 45% plus National Insurance, not as a capital gain.",
    );
    caveats.push("National Insurance on trading profit is not modelled.");
    const amount = money(Math.round((taxable * UK_INCOME_HIGHER_BPS) / 10_000));
    return {
      amount,
      label: "Income tax on trading profit (estimated)",
      effectiveRateBps: bps(UK_INCOME_HIGHER_BPS),
      basis: `Individual carrying out a trade. Profit of ${fmt(taxable)} taxed at the 40% higher rate as a screening assumption.`,
      requiresProfessionalReview: true,
      caveats,
    };
  }

  const gainTax = Math.round((taxable * UK_CGT_RESIDENTIAL_HIGHER_BPS) / 10_000);
  const rentTax = Math.round((Math.max(0, rentalProfit) * UK_INCOME_HIGHER_BPS) / 10_000);
  const amount = money(gainTax + rentTax);
  caveats.push(
    "Assumes the higher CGT rate with the annual exempt amount already used. Finance cost relief for individual landlords is restricted to a basic-rate credit and is not modelled.",
  );
  return {
    amount,
    label: "Capital gains tax and income tax (estimated)",
    effectiveRateBps: ratioBps(amount, money(Math.max(1, taxable + Math.max(0, rentalProfit)))),
    basis: `Individual investor. Gain taxed at 24%; rental profit of ${fmt(money(Math.max(0, rentalProfit)))} taxed at 40%.`,
    requiresProfessionalReview: true,
    caveats,
  };
}

/** Placeholder estimator for the generic US pack. */
export function usPlaceholderProfitTax(input: ProfitTaxInput): ProfitTaxAssessment {
  const taxable = money(Math.max(0, input.profitBeforeTax));
  const rateBps = input.isTrading ? 3_700 : 2_400;
  return {
    amount: money(Math.round((taxable * rateBps) / 10_000)),
    label: "Federal + state profit tax (placeholder)",
    effectiveRateBps: bps(rateBps),
    basis:
      "Illustrative blended rate. This pack models no real state and must be replaced before live use.",
    requiresProfessionalReview: true,
    caveats: [
      "Placeholder figure. Federal, state and local treatment vary enormously and none is modelled.",
      "Short-term gains, depreciation recapture and pass-through treatment are not modelled.",
    ],
  };
}

function fmt(value: number): string {
  return `£${Math.round(value / 100).toLocaleString("en-GB")}`;
}

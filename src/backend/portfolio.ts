import { appraise } from "@shared/domain/economics";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import {
  portfolioPosition,
  toHolding,
  type Holding,
  type PortfolioPosition,
} from "@shared/domain/portfolio";
import { listDeals } from "@backend/store/repository";
import type { DealRecord } from "@backend/store/schema";

/**
 * The portfolio, assembled from completed deals.
 *
 * A property appears here when the deal completes and the facts about holding
 * it are recorded, and it leaves when it is sold. Two conditions, both from
 * what is stored: a deal marked completed with no holding facts is a deal
 * nobody has finished recording, and it is reported as that rather than shown
 * with invented figures.
 */

export function holdingFrom(record: DealRecord): Holding | undefined {
  if (record.holding === undefined) return undefined;
  if (record.holding.soldAt !== undefined) return undefined;

  const inputs = toWorkingDeal(record.inputs).inputs;
  return toHolding({
    id: record.id,
    reference: record.reference,
    property: appraise(inputs).inputs.property,
    purchasePrice: inputs.purchasePrice,
    facts: record.holding,
  });
}

export interface PortfolioView {
  readonly position: PortfolioPosition;
  /** Completed deals with nothing recorded about holding them. */
  readonly unrecorded: readonly DealRecord[];
  /** Sold, and out of the portfolio. */
  readonly sold: readonly DealRecord[];
}

export async function portfolio(now: Date = new Date()): Promise<PortfolioView> {
  const records = await listDeals();
  const completed = records.filter((r) => r.status === "completed");

  const holdings: Holding[] = [];
  const unrecorded: DealRecord[] = [];
  const sold: DealRecord[] = [];

  for (const record of completed) {
    if (record.holding === undefined) {
      unrecorded.push(record);
      continue;
    }
    if (record.holding.soldAt !== undefined) {
      sold.push(record);
      continue;
    }
    const holding = holdingFrom(record);
    if (holding !== undefined) holdings.push(holding);
  }

  return { position: portfolioPosition(holdings, now), unrecorded, sold };
}

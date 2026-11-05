import { money, type Money } from "@shared/money";

/**
 * Auction follow-up (Independent AI Deal Engine spec §2, IND11).
 *
 * A lot's status is distinguished, never assumed: advertised, confirmed unsold,
 * withdrawn, sold, or availability unknown. A lot seen as unsold last month does
 * NOT become an available opportunity on its own — current availability stays
 * unverified until confirmed (IND11). Only charges explicitly confirmed from the
 * authorised legal/addendum pack are included in an appraisal; a guide price is
 * a marketing figure, not a value.
 *
 * Pure: the extractor supplies the lot's recorded facts; this assesses whether
 * there is a post-auction opportunity to pursue and what charges carry through.
 */

export type AuctionOutcome =
  | "advertised"
  | "unsold-confirmed"
  | "withdrawn"
  | "sold"
  | "availability-unknown";

export interface AuctionCharge {
  readonly label: string;
  readonly amountPence: Money;
  /** Only confirmed charges flow into an appraisal (§2). */
  readonly confirmed: boolean;
}

export interface AuctionLot {
  readonly id: string;
  readonly propertyId: string;
  readonly guidePence?: Money;
  readonly charges: readonly AuctionCharge[];
  readonly auctionDate: string;
  readonly conditions: readonly string[];
  readonly outcome: AuctionOutcome;
  /** When the current outcome/availability was last confirmed, if ever. */
  readonly availabilityConfirmedAt?: string;
}

export interface AuctionAssessment {
  readonly availabilityVerified: boolean;
  /** True only when the lot is genuinely pursuable now (verified available). */
  readonly opportunityOpen: boolean;
  /** Sum of the confirmed charges only — the figure an appraisal may use. */
  readonly confirmedChargesPence: Money;
  readonly note: string;
}

/** Days within which a confirmation is still considered current. */
export const AUCTION_FRESHNESS_DAYS = 7;

export function assessAuctionLot(lot: AuctionLot, now: Date): AuctionAssessment {
  const confirmedChargesPence = lot.charges
    .filter((c) => c.confirmed)
    .reduce<Money>((sum, c) => money(Number(sum) + Number(c.amountPence)), money(0));

  const confirmedRecently =
    lot.availabilityConfirmedAt !== undefined &&
    now.getTime() - new Date(lot.availabilityConfirmedAt).getTime() <= AUCTION_FRESHNESS_DAYS * 86_400_000;

  // An unsold or withdrawn lot can only be an opportunity once availability is
  // freshly confirmed — a month-old "unsold" tells you nothing about today.
  const pursuableOutcome = lot.outcome === "unsold-confirmed" || lot.outcome === "withdrawn" || lot.outcome === "advertised";
  const availabilityVerified = confirmedRecently && pursuableOutcome;
  const opportunityOpen = availabilityVerified;

  let note: string;
  if (lot.outcome === "sold") {
    note = "Sold at or after auction — not an opportunity.";
  } else if (!pursuableOutcome) {
    note = "Current availability is unknown; confirm status before treating it as available.";
  } else if (!confirmedRecently) {
    note = `Last recorded as "${lot.outcome}"; availability is unverified until re-confirmed.`;
  } else {
    note = `Available (confirmed): "${lot.outcome}".`;
  }

  return { availabilityVerified, opportunityOpen, confirmedChargesPence, note };
}

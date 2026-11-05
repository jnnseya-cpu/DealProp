import { describe, expect, it } from "vitest";
import { fromMajor, toMajor } from "@shared/money";
import { assessAuctionLot, type AuctionLot } from "@shared/domain/auction";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const daysBefore = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function lot(over: Partial<AuctionLot> = {}): AuctionLot {
  return {
    id: "lot-1",
    propertyId: "p-1",
    guidePence: fromMajor(150_000),
    charges: [
      { label: "Buyer's premium", amountPence: fromMajor(3_000), confirmed: true },
      { label: "Estimated legal pack", amountPence: fromMajor(1_500), confirmed: false },
    ],
    auctionDate: daysBefore(30),
    conditions: ["Completion in 28 days"],
    outcome: "unsold-confirmed",
    ...over,
  };
}

describe("auction follow-up (IND11)", () => {
  it("keeps availability unverified for a lot unsold last month until confirmed", () => {
    const a = assessAuctionLot(lot(), NOW); // no availabilityConfirmedAt
    expect(a.availabilityVerified).toBe(false);
    expect(a.opportunityOpen).toBe(false);
    expect(a.note).toMatch(/unverified/i);
  });

  it("opens the opportunity once availability is freshly confirmed", () => {
    const a = assessAuctionLot(lot({ availabilityConfirmedAt: daysBefore(1) }), NOW);
    expect(a.availabilityVerified).toBe(true);
    expect(a.opportunityOpen).toBe(true);
  });

  it("a stale confirmation does not count as verified", () => {
    const a = assessAuctionLot(lot({ availabilityConfirmedAt: daysBefore(30) }), NOW);
    expect(a.availabilityVerified).toBe(false);
  });

  it("never treats a sold lot as an opportunity", () => {
    const a = assessAuctionLot(lot({ outcome: "sold", availabilityConfirmedAt: daysBefore(1) }), NOW);
    expect(a.opportunityOpen).toBe(false);
    expect(a.note).toMatch(/Sold/i);
  });

  it("includes only confirmed charges in the appraisal figure", () => {
    const a = assessAuctionLot(lot(), NOW);
    expect(toMajor(a.confirmedChargesPence)).toBe(3_000); // premium only, not the estimate
  });
});

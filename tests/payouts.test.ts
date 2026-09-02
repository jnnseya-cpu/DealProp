import { describe, expect, it } from "vitest";
import { fromMajor, ZERO } from "@shared/money";
import {
  decidePayout,
  PAYOUT_HOLD_DAYS,
  payoutTotals,
  recipientIsPayable,
  RECIPIENT_VERIFICATION_MONTHS,
  splitWithProvider,
  type PayoutContext,
  type PayoutRecipient,
} from "@shared/domain/payouts";
import { providerFee, PROVIDER_COMMISSIONS } from "@shared/domain/pricing";
import { REFUND_WINDOW_DAYS } from "@shared/domain/reveal";

/**
 * Money going out.
 *
 * More dangerous than money coming in, because a payment in that was wrong can
 * be refunded and a payment out that was wrong is gone. Three failures decide
 * the design and each has a test: paying a share of money that is later
 * charged back, paying twice, and paying somebody nobody checked.
 */

const NOW = new Date("2026-09-01T00:00:00.000Z");
const COLLECTED = "2026-08-01T00:00:00.000Z";

const PAYABLE: PayoutRecipient = {
  id: "rec-1",
  name: "Marsh Surveyors",
  kind: "provider",
  connectedAccountId: "acct_1",
  verifiedAt: "2026-08-01T00:00:00.000Z",
  verifiedBy: "Jo Bloggs",
  verificationEvidence: "Companies House record and bank account holder confirmed.",
};

function context(over: Partial<PayoutContext> = {}): PayoutContext {
  return {
    recipient: PAYABLE,
    amount: fromMajor(450),
    collectedAt: COLLECTED,
    reversalOutstanding: false,
    alreadyPaid: false,
    sourceRefunded: false,
    now: NOW,
    ...over,
  };
}

describe("splitting a payment", () => {
  it("states the same number providerFee() states, from the other side", () => {
    // Two places that state an amount eventually disagree, and the partner
    // never loses that argument.
    for (const commission of PROVIDER_COMMISSIONS) {
      const gross = fromMajor(1_000);
      const split = splitWithProvider(gross, commission.kind);
      expect(split.platform, commission.kind).toBe(providerFee(commission.kind, gross));
      expect(split.recipient + split.platform, commission.kind).toBe(gross);
    }
  });

  it("never bills a recipient more than the payment", () => {
    // A fixed fee larger than the payment would pay them nothing and still
    // charge them. The extreme case is "we keep it all", not "they owe us".
    const tiny = splitWithProvider(fromMajor(50), "conveyancer");
    expect(tiny.recipient).toBe(ZERO);
    expect(tiny.platform).toBe(fromMajor(50));
  });

  it("says how the split was arrived at, in a sentence they can check", () => {
    const split = splitWithProvider(fromMajor(1_000), "surveyor");
    expect(split.basis).toContain("Surveyor");
    expect(split.basis).toContain("£100 of £1,000");
  });
});

describe("who may be paid", () => {
  it("refuses an unverified recipient, and one with nowhere to send it", () => {
    expect(recipientIsPayable(undefined, NOW)).toBe(false);
    expect(recipientIsPayable({ ...PAYABLE, verifiedAt: undefined }, NOW)).toBe(false);
    expect(recipientIsPayable({ ...PAYABLE, connectedAccountId: "  " }, NOW)).toBe(false);
    expect(recipientIsPayable({ ...PAYABLE, verificationEvidence: "" }, NOW)).toBe(false);
    expect(recipientIsPayable({ ...PAYABLE, verifiedBy: "" }, NOW)).toBe(false);
    expect(recipientIsPayable(PAYABLE, NOW)).toBe(true);
  });

  it("lapses, and refuses a date in the future", () => {
    expect(recipientIsPayable({ ...PAYABLE, verifiedAt: "2024-01-01T00:00:00.000Z" }, NOW)).toBe(false);
    expect(recipientIsPayable({ ...PAYABLE, verifiedAt: "2027-01-01T00:00:00.000Z" }, NOW)).toBe(false);
    expect(RECIPIENT_VERIFICATION_MONTHS).toBe(12);
  });

  it("says why sending money to an unchecked account is the failure it is", () => {
    const decision = decidePayout(context({ recipient: { ...PAYABLE, verifiedAt: undefined } }));
    expect(decision.payable).toBe(false);
    expect(decision.blockers.map((b) => b.remedy).join(" ")).toContain(
      "payment leg of somebody else's fraud",
    );
  });

  it("reports a suspension before the hold, because the advice differs", () => {
    // "Wait fourteen days" is the wrong thing to tell somebody whose account
    // we would never pay.
    const decision = decidePayout(
      context({
        recipient: { ...PAYABLE, suspendedAt: NOW.toISOString(), suspendedReason: "under review" },
        collectedAt: "2026-08-30T00:00:00.000Z",
      }),
    );
    expect(decision.blockers[0]?.reason).toContain("suspended");
  });
});

describe("the hold, and the block", () => {
  it("holds for exactly as long as the buyer's own refund window", () => {
    // Paying out before the guarantee expires is paying out money we have
    // promised to give back.
    expect(PAYOUT_HOLD_DAYS).toBe(REFUND_WINDOW_DAYS);

    const inside = decidePayout(context({ collectedAt: "2026-08-25T00:00:00.000Z" }));
    expect(inside.payable).toBe(false);
    expect(inside.blockers.map((b) => b.reason).join(" ")).toContain("inside the 14-day hold");
    expect(inside.releasesAt).toBe("2026-09-08T00:00:00.000Z");

    expect(decidePayout(context()).payable).toBe(true);
  });

  it("blocks entirely while a reversal is outstanding, however old the money is", () => {
    // The hold covers the refunds we control; this covers the ones we do not.
    // Paying a share of money that is later charged back loses the whole
    // amount rather than the commission.
    const disputed = decidePayout(
      context({ collectedAt: "2026-01-01T00:00:00.000Z", reversalOutstanding: true }),
    );
    expect(disputed.payable).toBe(false);
    expect(disputed.blockers.map((b) => b.remedy).join(" ")).toContain("loses the whole amount");
  });

  it("pays nothing at all on a payment that has been refunded", () => {
    const refunded = decidePayout(context({ sourceRefunded: true }));
    expect(refunded.payable).toBe(false);
    expect(refunded.blockers.map((b) => b.reason).join(" ")).toContain("has been refunded");
  });

  it("refuses a second payment of the same share", () => {
    const twice = decidePayout(context({ alreadyPaid: true }));
    expect(twice.payable).toBe(false);
    expect(twice.blockers.map((b) => b.remedy).join(" ")).toContain("paid once");
  });

  it("refuses a payout of nothing rather than sending it", () => {
    expect(decidePayout(context({ amount: ZERO })).payable).toBe(false);
  });

  it("refuses an unreadable collection date rather than treating it as old", () => {
    const bad = decidePayout(context({ collectedAt: "whenever" }));
    expect(bad.payable).toBe(false);
    expect(bad.releasesAt).toBeUndefined();
  });
});

describe("totalling a page of them", () => {
  it("separates what may go from what is held", () => {
    const totals = payoutTotals([
      decidePayout(context()),
      decidePayout(context({ amount: fromMajor(100), reversalOutstanding: true })),
    ]);
    expect(totals.payable).toBe(fromMajor(450));
    expect(totals.held).toBe(fromMajor(100));
  });
});

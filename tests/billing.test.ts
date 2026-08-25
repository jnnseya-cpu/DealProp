import { describe, expect, it } from "vitest";
import { fromMajor, ZERO } from "@shared/money";
import {
  CREDIT_PACKS,
  PLANS,
  creditPack,
  operationPrice,
  plan,
  priceBreakdown,
  taxDecision,
  UK_VAT,
} from "@shared/domain/pricing";
import {
  availableBalance,
  expiryFrom,
  planSpend,
  quoteRefund,
  reversalImpact,
  reversalShare,
  standing,
  type CreditLot,
  type LedgerEntry,
} from "@shared/domain/ledger";
import {
  coolingOff,
  entitlementsFor,
  withinLimit,
  withinPlan,
  type Subscription,
} from "@shared/domain/entitlements";
import { authorisePurchase, confirmationMatches } from "@shared/domain/charging";
import { mayStartTrial } from "@shared/domain/accounts";
import {
  isHandledEvent,
  parseSignatureHeader,
  signPayload,
  verifyWebhook,
} from "@backend/billing/webhook";

const NOW = new Date("2026-08-25T12:00:00.000Z");

function lot(overrides: Partial<CreditLot> = {}): CreditLot {
  return {
    id: "lot-1",
    accountId: "acc-1",
    kind: "purchased",
    original: fromMajor(100),
    remaining: fromMajor(100),
    cashGross: fromMajor(100),
    cashTax: fromMajor(16.67),
    createdAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2027-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    accountId: "acc-1",
    planId: "buyer-professional",
    status: "active",
    currentPeriodStart: "2026-08-01T00:00:00.000Z",
    currentPeriodEnd: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

/* --------------------------------------------------------------- pricing */

describe("the catalogue is the only source of a price", () => {
  it("gives every plan a unique id and non-negative price", () => {
    const ids = PLANS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PLANS) {
      expect(p.price, p.id).toBeGreaterThanOrEqual(0);
      expect(Number.isSafeInteger(p.price), p.id).toBe(true);
    }
  });

  it("prices every metered operation, so none is free by omission", () => {
    // An unpriced operation with a real marginal cost is a bill that grows with
    // usage and is collected from nobody.
    for (const op of ["ai-deal-analysis", "ai-underwriting-summary", "memorandum-export", "bulk-data-export"] as const) {
      expect(operationPrice(op), op).toBeGreaterThan(0);
    }
  });

  it("never gives away more bonus than was paid for", () => {
    for (const pack of CREDIT_PACKS) {
      expect(pack.bonus, pack.id).toBeLessThanOrEqual(pack.price);
      expect(pack.balance, pack.id).toBe(pack.price);
    }
  });
});

describe("VAT, where under-collecting is our loss", () => {
  it("charges UK VAT to a UK customer", () => {
    const decision = taxDecision({ country: "GB", kind: "consumer" });
    expect(decision.treatment).toBe("uk-vat");
    expect(decision.rateBps).toBe(UK_VAT.standardRateBps);
    expect(decision.mayCharge).toBe(true);
  });

  it("refuses a consumer sale outside the UK rather than guessing the rate", () => {
    // Charging UK VAT to a French consumer is wrong twice over: we remit to the
    // wrong state and still owe France.
    for (const country of ["FR", "DE", "US", "AU"]) {
      const decision = taxDecision({ country, kind: "consumer" });
      expect(decision.mayCharge, country).toBe(false);
      expect(decision.treatment, country).toBe("not-supported");
    }
  });

  it("reverse-charges an EU business that supplies a VAT number", () => {
    const decision = taxDecision({ country: "IE", kind: "business", vatNumber: "IE1234567X" });
    expect(decision.treatment).toBe("reverse-charge");
    expect(decision.rateBps).toBe(0);
  });

  it("treats an EU business with no VAT number as a consumer, and refuses", () => {
    expect(taxDecision({ country: "IE", kind: "business" }).mayCharge).toBe(false);
  });

  it("splits an inclusive price so net and tax add back to the gross", () => {
    // A penny that does not reconcile costs more to chase than it is worth.
    const uk = taxDecision({ country: "GB", kind: "consumer" });
    for (const price of [fromMajor(49), fromMajor(149), fromMajor(399), fromMajor(0.01)]) {
      const b = priceBreakdown(price, "inclusive", uk);
      expect(b.gross).toBe(price);
      expect(b.net + b.tax).toBe(b.gross);
    }
  });

  it("adds VAT on top of an exclusive price", () => {
    const uk = taxDecision({ country: "GB", kind: "business" });
    const b = priceBreakdown(fromMajor(1000), "exclusive", uk);
    expect(b.net).toBe(fromMajor(1000));
    expect(b.tax).toBe(fromMajor(200));
    expect(b.gross).toBe(fromMajor(1200));
  });

  it("adds nothing where the rate is zero", () => {
    const rc = taxDecision({ country: "IE", kind: "business", vatNumber: "IE1" });
    const b = priceBreakdown(fromMajor(999), "exclusive", rc);
    expect(b.gross).toBe(fromMajor(999));
    expect(b.tax).toBe(ZERO);
  });
});

/* ---------------------------------------------------------------- ledger */

describe("spending prepaid balance", () => {
  it("spends the balance that expires first", () => {
    const soon = lot({ id: "soon", expiresAt: "2026-09-01T00:00:00.000Z", original: fromMajor(10), remaining: fromMajor(10) });
    const later = lot({ id: "later", expiresAt: "2027-01-01T00:00:00.000Z" });

    const spend = planSpend([later, soon], fromMajor(5), NOW);
    expect(spend.allocations).toEqual([{ lotId: "soon", amount: fromMajor(5) }]);
  });

  it("spends granted balance before purchased balance of the same age", () => {
    // Otherwise somebody consumes the free part and withdraws the paid part in
    // cash, which turns a bonus into a discount on nothing.
    const purchased = lot({ id: "paid", kind: "purchased" });
    const granted = lot({ id: "free", kind: "granted", cashGross: ZERO, cashTax: ZERO });

    const spend = planSpend([purchased, granted], fromMajor(10), NOW);
    expect(spend.allocations[0]?.lotId).toBe("free");
  });

  it("is all or nothing", () => {
    const spend = planSpend([lot({ remaining: fromMajor(4) })], fromMajor(10), NOW);
    expect(spend.ok).toBe(false);
    expect(spend.allocations).toEqual([]);
    expect(spend.shortfall).toBe(fromMajor(6));
  });

  it("will not spend expired balance", () => {
    const expired = lot({ expiresAt: "2026-01-01T00:00:00.000Z" });
    expect(availableBalance([expired], NOW)).toBe(ZERO);
    expect(planSpend([expired], fromMajor(1), NOW).ok).toBe(false);
  });

  it("will not spend a voided lot", () => {
    const voided = lot({ voidedAt: "2026-08-10T00:00:00.000Z", voidedReason: "chargeback" });
    expect(availableBalance([voided], NOW)).toBe(ZERO);
  });

  it("refuses a negative spend", () => {
    // A negative charge is a credit. Giving balance away must be an explicit
    // adjustment with its own record, never a spend with a minus sign.
    expect(planSpend([lot()], fromMajor(-5), NOW).ok).toBe(false);
  });

  it("treats an unreadable expiry date as expired", () => {
    expect(availableBalance([lot({ expiresAt: "not a date" })], NOW)).toBe(ZERO);
  });
});

describe("refunds never pay out more than came in", () => {
  it("refunds nothing for granted balance", () => {
    const quote = quoteRefund(lot({ kind: "granted", cashGross: ZERO, cashTax: ZERO }), NOW);
    expect(quote.refundable).toBe(false);
    expect(quote.gross).toBe(ZERO);
  });

  it("refunds in proportion to what is left, rounded down", () => {
    // £100 paid, a third spent. Rounding the payout up would give away a penny
    // per refund that nothing recovers.
    const partly = lot({ original: fromMajor(100), remaining: fromMajor(33.33) });
    const quote = quoteRefund(partly, NOW);
    expect(quote.gross).toBeLessThanOrEqual(fromMajor(33.33));
    expect(quote.gross).toBe(3333);
  });

  it("refunds nothing once the balance is spent", () => {
    expect(quoteRefund(lot({ remaining: ZERO }), NOW).refundable).toBe(false);
  });

  it("refunds nothing twice", () => {
    expect(quoteRefund(lot({ voidedAt: "2026-08-10T00:00:00.000Z" }), NOW).refundable).toBe(false);
  });

  it("refunds nothing after expiry", () => {
    expect(quoteRefund(lot({ expiresAt: "2026-01-01T00:00:00.000Z" }), NOW).refundable).toBe(false);
  });

  it("never returns more tax than gross", () => {
    const quote = quoteRefund(lot({ cashTax: fromMajor(999) }), NOW);
    expect(quote.tax).toBeLessThanOrEqual(quote.gross);
  });
});

describe("a reversal after the balance was used", () => {
  const debt = (amount: number): LedgerEntry => ({
    id: "d1",
    at: "2026-08-20T00:00:00.000Z",
    accountId: "acc-1",
    kind: "debt",
    amount: amount as LedgerEntry["amount"],
    idempotencyKey: "debt-1",
    reason: "Spent before the payment was reversed.",
  });

  it("shows what is owed and stops further spending", () => {
    const position = standing([lot({ remaining: ZERO })], [debt(-fromMajor(70))], NOW);
    expect(position.owed).toBe(fromMajor(70));
    expect(position.maySpend).toBe(false);
  });

  it("owes nothing where the whole lot was still unspent", () => {
    const untouched = lot({ voidedAt: "2026-08-20T00:00:00.000Z", voidedReason: "chargeback" });
    const position = standing([untouched], [], NOW);
    expect(position.owed).toBe(ZERO);
    expect(position.maySpend).toBe(true);
  });

  it("clears the debt when it is written off, rather than doubling it", () => {
    // A write-off is a positive debt entry. Summing magnitudes rather than
    // signs would make forgiving a debt increase it.
    const position = standing(
      [lot({ remaining: ZERO })],
      [debt(-fromMajor(70)), { ...debt(fromMajor(70)), id: "d2", idempotencyKey: "w-1" }],
      NOW,
    );
    expect(position.owed).toBe(ZERO);
    expect(position.maySpend).toBe(true);
  });

  it("never turns an over-generous write-off into a balance", () => {
    const position = standing(
      [lot({ remaining: ZERO })],
      [debt(-fromMajor(10)), { ...debt(fromMajor(999)), id: "d2", idempotencyKey: "w-1" }],
      NOW,
    );
    expect(position.owed).toBe(ZERO);
  });

  it("keeps provider fees apart from what the customer owes", () => {
    // Winning a dispute does not give the fee back, so it is our cost and not a
    // debt to pursue. Rolling them together would overstate one or hide the other.
    const fee: LedgerEntry = {
      id: "f1",
      at: "2026-08-20T00:00:00.000Z",
      accountId: "acc-1",
      kind: "fee",
      amount: -fromMajor(15) as LedgerEntry["amount"],
      idempotencyKey: "fee-1",
      reason: "Dispute fee.",
    };
    const position = standing([lot()], [fee], NOW);
    expect(position.fees).toBe(fromMajor(15));
    expect(position.owed).toBe(ZERO);
    expect(position.maySpend).toBe(true);
  });

  it("lets an ordinary account spend", () => {
    expect(standing([lot()], [], NOW).maySpend).toBe(true);
  });
});

describe("what a reversal actually takes back", () => {
  it("takes everything and owes nothing where nothing was spent", () => {
    const impact = reversalImpact(lot(), 1);
    expect(impact.balanceRemoved).toBe(fromMajor(100));
    expect(impact.debt).toBe(ZERO);
    expect(impact.voids).toBe(true);
  });

  it("owes what was already consumed on a full reversal", () => {
    const impact = reversalImpact(lot({ remaining: fromMajor(30) }), 1);
    expect(impact.balanceRemoved).toBe(fromMajor(30));
    expect(impact.debt).toBe(fromMajor(70));
  });

  it("takes only what a partial refund paid for, and owes nothing", () => {
    // Stripping balance the customer still owns produces the second dispute,
    // from a customer who is by then right.
    const impact = reversalImpact(lot({ remaining: fromMajor(30) }), 0.3);
    expect(impact.balanceRemoved).toBe(fromMajor(30));
    expect(impact.debt).toBe(ZERO);
    expect(impact.voids).toBe(false);
  });

  it("owes the shortfall where a partial refund exceeds what is unspent", () => {
    const impact = reversalImpact(lot({ remaining: fromMajor(30) }), 0.5);
    expect(impact.balanceRemoved).toBe(fromMajor(30));
    expect(impact.debt).toBe(fromMajor(20));
  });

  it("does nothing to a lot already reversed", () => {
    const impact = reversalImpact(lot({ voidedAt: "2026-08-10T00:00:00.000Z" }), 1);
    expect(impact.balanceRemoved).toBe(ZERO);
    expect(impact.debt).toBe(ZERO);
  });

  it("claws a bonus back in the same proportion as the payment", () => {
    // The bug this replaced: the share was computed per lot, so a bonus lot
    // with no cash behind it looked fully refunded and was wiped whole. A £40
    // refund of a £100 top-up carrying a £5 bonus took £45.
    const purchased = lot({ id: "paid", cashGross: fromMajor(100) });
    const bonus = lot({ id: "bonus", kind: "granted", original: fromMajor(5), remaining: fromMajor(5), cashGross: ZERO });

    const share = reversalShare([purchased, bonus], fromMajor(40));
    expect(reversalImpact(purchased, share).balanceRemoved).toBe(fromMajor(40));
    expect(reversalImpact(bonus, share).balanceRemoved).toBe(fromMajor(2));
  });

  it("treats a reversal with no cash recorded as a full one", () => {
    expect(reversalShare([lot({ cashGross: ZERO })], fromMajor(5))).toBe(1);
  });

  it("never claws back more than the payment, whatever the provider reports", () => {
    expect(reversalShare([lot({ cashGross: fromMajor(100) })], fromMajor(500))).toBe(1);
  });
});

describe("expiry", () => {
  it("computes an expiry a fixed number of months out", () => {
    expect(expiryFrom("2026-08-01T00:00:00.000Z", 12).slice(0, 10)).toBe("2027-08-01");
    expect(expiryFrom("2026-08-01T00:00:00.000Z", 3).slice(0, 10)).toBe("2026-11-01");
  });
});

/* ---------------------------------------------------------- entitlements */

describe("what stops when paying stops", () => {
  it("gives the free plan to an account with no subscription", () => {
    const e = entitlementsFor(undefined, NOW);
    expect(e.planId).toBe("buyer-explorer");
    expect(e.mayExtractValue).toBe(false);
    expect(e.memorandaPerPeriod).toBe(0);
  });

  it("gives the paid plan while it is paid for", () => {
    const e = entitlementsFor(subscription(), NOW);
    expect(e.planId).toBe("buyer-professional");
    expect(e.maxBuyBoxes).toBe("unlimited");
    expect(e.mayExtractValue).toBe(true);
  });

  it("drops to the free plan when the paid period lapses with no renewal", () => {
    // The leak: nothing arrives to say the subscription ended, so a status left
    // at active keeps serving the product for nothing.
    const e = entitlementsFor(
      subscription({ currentPeriodEnd: "2026-08-01T00:00:00.000Z" }),
      NOW,
    );
    expect(e.planId).toBe("buyer-explorer");
    expect(e.mayExtractValue).toBe(false);
  });

  it("honours a cancellation to the end of the period already paid for", () => {
    const e = entitlementsFor(
      subscription({ status: "canceled", currentPeriodEnd: "2026-09-01T00:00:00.000Z" }),
      NOW,
    );
    expect(e.planId).toBe("buyer-professional");
  });

  it("stops a cancelled account the day the paid period ends, with nothing needing to run", () => {
    const e = entitlementsFor(
      subscription({ status: "canceled", currentPeriodEnd: "2026-08-01T00:00:00.000Z" }),
      NOW,
    );
    expect(e.planId).toBe("buyer-explorer");
  });

  it("keeps access but stops extraction while a payment is being retried", () => {
    const e = entitlementsFor(
      subscription({ status: "past-due", delinquentSince: "2026-08-23T00:00:00.000Z" }),
      NOW,
    );
    expect(e.planId).toBe("buyer-professional");
    expect(e.memorandaPerPeriod).toBe(0);
    expect(e.periodCredits).toBe(ZERO);
    expect(e.mayExtractValue).toBe(false);
  });

  it("drops to free once the grace window is past", () => {
    const e = entitlementsFor(
      subscription({ status: "past-due", delinquentSince: "2026-08-01T00:00:00.000Z" }),
      NOW,
    );
    expect(e.planId).toBe("buyer-explorer");
  });

  it("gives a trial the features but not the takeaway", () => {
    // A trial that grants memoranda and a credit balance is a trial somebody
    // takes once per email address.
    const e = entitlementsFor(
      subscription({ status: "trialing", trialEndsAt: "2026-09-01T00:00:00.000Z" }),
      NOW,
    );
    expect(e.dealRooms).toBe(true);
    expect(e.memorandaPerPeriod).toBe(1);
    expect(e.periodCredits).toBe(ZERO);
  });

  it("ends a trial that has run out", () => {
    const e = entitlementsFor(
      subscription({ status: "trialing", trialEndsAt: "2026-08-01T00:00:00.000Z" }),
      NOW,
    );
    expect(e.planId).toBe("buyer-explorer");
  });

  it("gives a blocked account nothing, whatever the dates say", () => {
    const e = entitlementsFor(
      subscription({ status: "blocked", blockedReason: "Payment disputed." }),
      NOW,
    );
    expect(e.planId).toBe("buyer-explorer");
    expect(e.reason).toContain("disputed");
  });

  it("falls back to free for a plan withdrawn from the catalogue", () => {
    const e = entitlementsFor(subscription({ planId: "buyer-legacy" as never }), NOW);
    expect(e.planId).toBe("buyer-explorer");
  });

  it("always gives a reason", () => {
    for (const status of ["trialing", "active", "past-due", "unpaid", "canceled", "blocked"] as const) {
      expect(entitlementsFor(subscription({ status }), NOW).reason, status).not.toBe("");
    }
  });
});

describe("limits", () => {
  it("allows up to the limit and not past it", () => {
    expect(withinLimit(2, 3, "Buy Boxes").allowed).toBe(true);
    expect(withinLimit(3, 3, "Buy Boxes").allowed).toBe(false);
    expect(withinLimit(999, "unlimited", "Buy Boxes").allowed).toBe(true);
  });

  it("says a feature is not included rather than that a limit is reached", () => {
    expect(withinLimit(0, 0, "Funding Boxes").reason).toContain("not included");
  });

  it("keeps the oldest records when a plan is downgraded", () => {
    // The quiet leak: ten mandates created on the top plan, kept after dropping
    // to the plan that includes three, because the limit is only ever checked
    // when creating.
    const items = [
      { id: "c", createdAt: "2026-03-01" },
      { id: "a", createdAt: "2026-01-01" },
      { id: "b", createdAt: "2026-02-01" },
    ];
    const { covered, excess } = withinPlan(items, 2);
    expect(covered.map((i) => i.id)).toEqual(["a", "b"]);
    expect(excess.map((i) => i.id)).toEqual(["c"]);
  });

  it("covers everything on an unlimited plan", () => {
    const items = [{ id: "a" }, { id: "b" }];
    expect(withinPlan(items, "unlimited").excess).toEqual([]);
  });
});

describe("the cancellation right that costs a full refund", () => {
  it("owes the whole fee back where the customer never agreed to immediate supply", () => {
    // Thirteen days of use and a full refund, because the acknowledgement that
    // ends the right was never taken.
    const decision = coolingOff(
      { currentPeriodStart: "2026-08-20T00:00:00.000Z" },
      "consumer",
      NOW,
    );
    expect(decision.withinPeriod).toBe(true);
    expect(decision.refundDue).toBe("full");
  });

  it("owes only the unsupplied part where the agreement was taken", () => {
    const decision = coolingOff(
      {
        currentPeriodStart: "2026-08-20T00:00:00.000Z",
        immediateSupplyConsent: { at: "2026-08-20T00:00:00.000Z", statement: "Begin at once." },
      },
      "consumer",
      NOW,
    );
    expect(decision.refundDue).toBe("pro-rata");
  });

  it("does not apply to a business", () => {
    expect(
      coolingOff({ currentPeriodStart: "2026-08-20T00:00:00.000Z" }, "business", NOW).refundDue,
    ).toBe("none");
  });

  it("does not apply after fourteen days", () => {
    expect(
      coolingOff({ currentPeriodStart: "2026-07-01T00:00:00.000Z" }, "consumer", NOW).refundDue,
    ).toBe("none");
  });
});

/* -------------------------------------------------------------- charging */

describe("a purchase request cannot name its own price", () => {
  const uk = { country: "GB", kind: "consumer" as const };
  const context = { customer: uk, permissionsHeld: [], owesUs: false };

  it("prices a plan from the catalogue", () => {
    const auth = authorisePurchase({ kind: "plan", planId: "buyer-investor" }, context);
    expect(auth.allowed).toBe(true);
    expect(auth.price.gross).toBe(plan("buyer-investor")?.price);
  });

  it("refuses a plan that does not exist", () => {
    expect(authorisePurchase({ kind: "plan", planId: "free-everything" as never }, context).allowed).toBe(false);
  });

  it("refuses a pack that does not exist", () => {
    expect(authorisePurchase({ kind: "topup", packId: "topup-999999" }, context).allowed).toBe(false);
  });

  it("refuses to charge for the free plan", () => {
    expect(authorisePurchase({ kind: "plan", planId: "buyer-explorer" }, context).allowed).toBe(false);
  });

  it("refuses anybody who owes us money", () => {
    const auth = authorisePurchase(
      { kind: "topup", packId: "topup-25" },
      { ...context, owesUs: true },
    );
    expect(auth.allowed).toBe(false);
    expect(auth.reason).toContain("reversed");
  });

  it("refuses a sale it cannot tax correctly", () => {
    const auth = authorisePurchase(
      { kind: "plan", planId: "buyer-investor" },
      { ...context, customer: { country: "FR", kind: "consumer" } },
    );
    expect(auth.allowed).toBe(false);
  });

  it("prices a top-up including its bonus in the description only", () => {
    const pack = creditPack("topup-100");
    const auth = authorisePurchase({ kind: "topup", packId: "topup-100" }, context);
    expect(auth.price.gross).toBe(pack?.price);
    expect(auth.description).toContain("bonus");
  });
});

describe("confirming what was actually paid", () => {
  const expected = { gross: fromMajor(100), currency: "GBP" };

  it("accepts the amount the catalogue would have charged", () => {
    expect(confirmationMatches(expected, { amountMinorUnits: 10_000, currency: "GBP" }).matches).toBe(true);
  });

  it("refuses an underpayment", () => {
    expect(confirmationMatches(expected, { amountMinorUnits: 1, currency: "GBP" }).matches).toBe(false);
  });

  it("refuses an overpayment, which usually means the wrong charge", () => {
    expect(confirmationMatches(expected, { amountMinorUnits: 50_000, currency: "GBP" }).matches).toBe(false);
  });

  it("refuses another currency", () => {
    expect(confirmationMatches(expected, { amountMinorUnits: 10_000, currency: "USD" }).matches).toBe(false);
  });

  it("refuses a confirmation with no amount at all", () => {
    expect(confirmationMatches(expected, { amountMinorUnits: undefined, currency: "GBP" }).matches).toBe(false);
  });
});

/* --------------------------------------------------------------- webhook */

describe("the endpoint that would otherwise give the platform away", () => {
  const SECRET = "a-webhook-secret-of-adequate-length";
  const body = JSON.stringify({ id: "evt_1", type: "payment.succeeded" });
  const seconds = Math.floor(NOW.getTime() / 1000);

  it("accepts a correctly signed, current delivery", () => {
    const header = signPayload(body, seconds, SECRET);
    expect(verifyWebhook(body, header, NOW, SECRET).ok).toBe(true);
  });

  it("refuses everything when no secret is configured", () => {
    // Fails closed, like the cron endpoint. An unconfigured deployment must not
    // be a permissive one.
    const header = signPayload(body, seconds, SECRET);
    expect(verifyWebhook(body, header, NOW, undefined).ok).toBe(false);
    expect(verifyWebhook(body, header, NOW, "").failure).toBe("not-configured");
  });

  it("refuses an unsigned delivery", () => {
    expect(verifyWebhook(body, null, NOW, SECRET).failure).toBe("missing-signature");
  });

  it("refuses a forged signature", () => {
    const forged = signPayload(body, seconds, "not-the-secret");
    expect(verifyWebhook(body, forged, NOW, SECRET).failure).toBe("bad-signature");
  });

  it("refuses a body altered after signing", () => {
    // The whole point: a valid signature over a different body would let an
    // attacker change the amount on a real confirmation.
    const header = signPayload(body, seconds, SECRET);
    const tampered = JSON.stringify({ id: "evt_1", type: "payment.succeeded", amount: 999_999 });
    expect(verifyWebhook(tampered, header, NOW, SECRET).ok).toBe(false);
  });

  it("refuses a delivery captured and replayed later", () => {
    const old = signPayload(body, seconds - 3600, SECRET);
    expect(verifyWebhook(body, old, NOW, SECRET).failure).toBe("stale");
  });

  it("refuses a timestamp from the future beyond tolerance", () => {
    const ahead = signPayload(body, seconds + 3600, SECRET);
    expect(verifyWebhook(body, ahead, NOW, SECRET).failure).toBe("stale");
  });

  it("parses only the header shape it expects", () => {
    expect(parseSignatureHeader(null)).toBeUndefined();
    expect(parseSignatureHeader("")).toBeUndefined();
    expect(parseSignatureHeader("v1=abc")).toBeUndefined();
    expect(parseSignatureHeader("t=123")).toBeUndefined();
    expect(parseSignatureHeader("t=123,v1=nothex!")).toBeUndefined();
    expect(parseSignatureHeader("t=123,v1=ABCD")).toEqual({ timestamp: 123, signature: "abcd" });
  });

  it("acts only on events it knows", () => {
    // A new provider event must do nothing until somebody decides what it
    // should do, rather than falling through to something that grants access.
    expect(isHandledEvent("payment.succeeded")).toBe(true);
    expect(isHandledEvent("payment.something_new")).toBe(false);
    expect(isHandledEvent("")).toBe(false);
  });

  it("never puts the signature or the secret in the reason", () => {
    const forged = signPayload(body, seconds, "not-the-secret");
    const result = verifyWebhook(body, forged, NOW, SECRET);
    expect(result.reason).not.toContain(SECRET);
    expect(result.reason).not.toContain(forged);
  });
});

/* ----------------------------------------------------------------- trials */

describe("a trial is one per account", () => {
  it("allows the first", () => {
    expect(mayStartTrial({}).allowed).toBe(true);
  });

  it("refuses a second, whatever happened to the first", () => {
    // Cancelling and starting again is the cheapest version of never paying.
    const decision = mayStartTrial({ trialClaimedAt: "2026-01-01T00:00:00.000Z" });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("2026-01-01");
  });

  it("refuses a disabled account", () => {
    expect(mayStartTrial({ disabledAt: "2026-05-01T00:00:00.000Z" }).allowed).toBe(false);
  });
});

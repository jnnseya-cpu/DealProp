import { describe, expect, it } from "vitest";
import { fromMajor, ZERO } from "@shared/money";
import { heldKeys, readPermissions } from "@shared/domain/permissions";
import {
  CATEGORIES,
  categoryDefect,
  categoryDefinition,
  classifyOpportunity,
  saleIsConfirmed,
  type InventoryItem,
  type SaleConfirmation,
} from "@shared/domain/inventory";
import {
  decideRefund,
  opportunityCard,
  quoteReveal,
  REFUND_REASONS,
  REFUND_WINDOW_DAYS,
  REVEAL_GUARANTEE,
  SELLER_RESPONSE_DAYS,
  type RefundTrigger,
  type RevealContext,
} from "@shared/domain/reveal";
import { authorisePurchase } from "@shared/domain/charging";
import { buyerPassport } from "@shared/domain/passport";
import { materialInformation, type MaterialRecord } from "@shared/domain/materialInformation";
import { sellerDueDiligence } from "@shared/domain/sellerDueDiligence";
import { revealPrice } from "@shared/domain/pricing";
import type { PropertyFacts } from "@shared/domain/types";
import { bps } from "@shared/money";

/**
 * Charging for an opportunity.
 *
 * The failure this file exists to prevent is one thing: a buyer pays to open
 * something, and finds an owner who never agreed to sell. They only discover
 * it after paying, and they tell people. Everything below is the structure
 * that makes it impossible rather than unlikely.
 */

const OWNER_SAID: SaleConfirmation = {
  by: "owner",
  at: "2026-08-10T00:00:00.000Z",
  recordedBy: "Jo Bloggs",
  evidence: "Told us on the phone she wants it sold by Christmas and is happy to be contacted.",
};

const EVERYTHING = heldKeys(
  readPermissions("estate-agency-aml:XAML00000000,redress-scheme:TPO-12345"),
);

const NOW = new Date("2026-09-01T00:00:00.000Z");

/** A buyer who has been checked. Grade A against the guide price used here. */
const PROCEEDABLE = buyerPassport(
  {
    identityVerifiedAt: "2026-06-01T00:00:00.000Z",
    identityMethod: "Photo ID and address, checked electronically",
    screenedAt: "2026-08-01T00:00:00.000Z",
    sourceOfFundsAt: "2026-08-01T00:00:00.000Z",
    proofOfFunds: {
      kind: "cash",
      evidencedAt: "2026-08-20T00:00:00.000Z",
      amount: fromMajor(250_000),
      issuer: "Lloyds",
    },
    completedPurchases: 2,
  },
  fromMajor(172_000),
  NOW,
);

const SELLER_CHECKED = sellerDueDiligence(
  {
    kind: "individual",
    identityVerifiedAt: "2026-08-01T00:00:00.000Z",
    identityMethod: "Photo ID and proof of address",
    screenedAt: "2026-08-01T00:00:00.000Z",
    authorityEvidencedAt: "2026-08-01T00:00:00.000Z",
    authorityEvidence: "Named as sole registered proprietor on title WM123456.",
    riskAssessedAt: "2026-08-01T00:00:00.000Z",
    riskAssessedBy: "Jo Bloggs",
  },
  NOW,
);

/** Part A answered, which is what a property needs before it may be marketed. */
const MARKETABLE: MaterialRecord = {
  price: { state: "stated", value: "£172,000" },
  tenure: { state: "stated", value: "Freehold" },
  "council-tax": { state: "stated", value: "Band B" },
};

function context(overrides: Partial<RevealContext> = {}): RevealContext {
  return {
    opportunity: "owner-verified",
    item: { category: "owner-verified", confirmation: OWNER_SAID },
    permissionsHeld: EVERYTHING,
    passport: PROCEEDABLE,
    material: materialInformation(property(), MARKETABLE),
    sellerChecks: SELLER_CHECKED,
    ...overrides,
  };
}

const property = (over: Partial<PropertyFacts> = {}): PropertyFacts => ({
  id: "p",
  jurisdiction: "GB-ENG",
  postcodeArea: "B23",
  locality: "Erdington",
  propertyType: "house",
  tenure: "freehold",
  bedrooms: 3,
  occupancy: "owner-occupied",
  openMarketValue: fromMajor(212_000),
  valuationConfidence: bps(8_500),
  refurbishmentEstimate: ZERO,
  postWorksValue: fromMajor(212_000),
  monthlyRent: fromMajor(1_100),
  knownIssues: [],
  ...over,
});

describe("the three categories", () => {
  it("says plainly, on discovered stock, that nobody has confirmed anything", () => {
    // The one sentence that decides whether a buyer feels informed or cheated.
    // It is not softened and it is not a footnote.
    const said = categoryDefinition("ai-discovered").disclosure;
    expect(said).toContain("Nobody connected to the property has confirmed it is for sale");
    expect(said).toContain("may not be");
  });

  it("treats a category claiming more than is known as a defect", () => {
    const claimed: InventoryItem = { category: "owner-verified" };
    expect(categoryDefect(claimed)).toContain("no confirmation recorded");
    expect(saleIsConfirmed(claimed)).toBe(false);

    const wrongSource: InventoryItem = {
      category: "owner-verified",
      confirmation: { ...OWNER_SAID, by: "instructed-agent" },
    };
    expect(categoryDefect(wrongSource)).toContain("instructed agent");
    expect(saleIsConfirmed(wrongSource)).toBe(false);
  });

  it("also catches under-claiming, because the buyer is told less than is true", () => {
    const stale: InventoryItem = { category: "ai-discovered", confirmation: OWNER_SAID };
    expect(categoryDefect(stale)).toContain("Reclassify");
  });

  it("is honest when the category matches what is recorded", () => {
    for (const definition of CATEGORIES) {
      const item: InventoryItem =
        definition.requiresConfirmationBy === undefined
          ? { category: definition.category }
          : {
              category: definition.category,
              confirmation: { ...OWNER_SAID, by: definition.requiresConfirmationBy },
            };
      expect(categoryDefect(item), definition.category).toBeUndefined();
    }
  });
});

describe("what an opportunity is classified as", () => {
  it("is derived from the property, so two identical ones cannot be priced apart", () => {
    expect(classifyOpportunity(property({ propertyType: "land" }), undefined)).toBe("land");
    expect(classifyOpportunity(property({ propertyType: "commercial" }), undefined)).toBe("commercial");
    expect(classifyOpportunity(property({ propertyType: "hmo" }), undefined)).toBe("hmo-mixed-use");
    expect(classifyOpportunity(property({ occupancy: "vacant" }), undefined)).toBe("vacant-refurbishment");
    expect(classifyOpportunity(property(), undefined)).toBe("standard-residential");
  });

  it("only reaches the owner-verified price when the owner actually confirmed", () => {
    const confirmed: InventoryItem = { category: "owner-verified", confirmation: OWNER_SAID };
    expect(classifyOpportunity(property(), confirmed)).toBe("owner-verified");

    // The same claim with nothing behind it prices as ordinary stock, which is
    // the direction the error has to fall in.
    const claimed: InventoryItem = { category: "owner-verified" };
    expect(classifyOpportunity(property(), claimed)).toBe("standard-residential");
  });
});

describe("whether the reveal may be charged", () => {
  it("refuses on stock nobody has confirmed is for sale", () => {
    const discovered = quoteReveal(
      context({
        opportunity: "standard-residential",
        item: { category: "ai-discovered" },
      }),
    );
    expect(discovered.chargeable).toBe(false);
    const said = discovered.blockers.map((b) => `${b.reason} ${b.remedy}`).join(" ");
    expect(said).toContain("Nobody connected to the property has confirmed");
    expect(said).toContain("has been sold nothing");

    // It may still be shown — with its sentence. Refusing to sell it is not
    // refusing to list it.
    expect(discovered.disclosure).toBe(categoryDefinition("ai-discovered").disclosure);
  });

  it("refuses without the estate agency permissions, whichever way the money flows", () => {
    const none = quoteReveal(context({ permissionsHeld: [] }));
    expect(none.chargeable).toBe(false);
    expect(none.blockers.map((b) => b.remedy).join(" ")).toContain("estate agency work");
  });

  it("refuses a buyer nobody has checked, and one checked but unfunded", () => {
    // A reveal ends in an introduction, so the gate on approaching a seller is
    // the gate on paying. Checking after the money has moved is too late for
    // both sides.
    const ungraded = quoteReveal({ ...context(), passport: undefined });
    expect(ungraded.chargeable).toBe(false);
    expect(ungraded.blockers.map((b) => b.remedy).join(" ")).toContain("destroys its own supply");

    const identifiedOnly = buyerPassport(
      {
        identityVerifiedAt: "2026-06-01T00:00:00.000Z",
        screenedAt: "2026-08-01T00:00:00.000Z",
      },
      fromMajor(172_000),
      NOW,
    );
    expect(identifiedOnly.grade).toBe("C");
    expect(quoteReveal(context({ passport: identifiedOnly })).chargeable).toBe(false);
  });

  it("refuses on a property that is already gone, and on a second charge", () => {
    expect(quoteReveal(context({ closed: true })).chargeable).toBe(false);
    expect(quoteReveal(context({ alreadyOpened: true })).chargeable).toBe(false);
    expect(
      quoteReveal(context({ alreadyOpened: true })).blockers.map((b) => b.remedy).join(" "),
    ).toContain("access they already have");
  });

  it("charges the catalogue price for the class, and shows the guarantee with it", () => {
    const quote = quoteReveal(context());
    expect(quote.chargeable).toBe(true);
    expect(quote.price).toBe(revealPrice("owner-verified").standard);
    expect(quote.guarantee).toEqual(REVEAL_GUARANTEE);
    expect(quote.guarantee.join(" ")).toContain("nobody has to be persuaded");
  });
});

describe("the card a buyer sees before paying", () => {
  const card = () =>
    opportunityCard({
      reference: "LODE-0001",
      property: property({ occupancy: "tenanted-arrears" }),
      guidePrice: fromMajor(172_000),
      item: { category: "owner-verified", confirmation: OWNER_SAID },
      quote: quoteReveal(context()),
    });

  it("carries the property and the price, and the category sentence with them", () => {
    const shown = card();
    expect(shown.locality).toBe("Erdington");
    expect(shown.guidePrice).toBe(fromMajor(172_000));
    expect(shown.disclosure).toBe(categoryDefinition("owner-verified").disclosure);
    expect(shown.revealPrice).toBe(revealPrice("owner-verified").standard);
  });

  it("gives away neither the address nor the seller's situation nor a return", () => {
    // Three separate reasons, one shape. The address is the product; the
    // situation is the seller's private information; a return figure would make
    // the card a financial promotion under FSMA s.21.
    const text = JSON.stringify(card()).toLowerCase();
    for (const word of [
      "arrears",
      "probate",
      "divorce",
      "repossession",
      "distress",
      "margin",
      "yield",
      "roi",
      "profit",
    ]) {
      expect(text, word).not.toContain(word);
    }

    // A closed shape rather than a filtered deal: the keys are the whole
    // contract, so a field added to the deal cannot leak through this.
    expect(Object.keys(card()).sort()).toEqual(
      [
        "area",
        "bedrooms",
        "category",
        "disclosure",
        "guidePrice",
        "locality",
        "openable",
        "opportunity",
        "propertyType",
        "reference",
        "revealPrice",
        "tenure",
      ].sort(),
    );
  });

  it("says plainly when it cannot be opened rather than hiding it", () => {
    const unconfirmed = opportunityCard({
      reference: "LODE-0002",
      property: property(),
      guidePrice: fromMajor(172_000),
      item: { category: "ai-discovered" },
      quote: quoteReveal(
        context({ opportunity: "standard-residential", item: { category: "ai-discovered" } }),
      ),
    });
    expect(unconfirmed.openable).toBe(false);
    expect(unconfirmed.disclosure).toContain("Nobody connected to the property has confirmed");
  });
});

describe("the checkout", () => {
  const customer = { country: "GB", kind: "consumer" } as const;

  it("will not take money for a reveal it has not been given a quote for", () => {
    const refused = authorisePurchase(
      { kind: "reveal", opportunityId: "o1" },
      { customer, permissionsHeld: EVERYTHING, owesUs: false },
    );
    expect(refused.allowed).toBe(false);
    expect(refused.price.gross).toBe(ZERO);
  });

  it("will not take money for a blocked quote", () => {
    const refused = authorisePurchase(
      { kind: "reveal", opportunityId: "o1" },
      {
        customer,
        permissionsHeld: EVERYTHING,
        owesUs: false,
        reveal: quoteReveal(context({ item: { category: "ai-discovered" } })),
      },
    );
    expect(refused.allowed).toBe(false);
    expect(refused.reason).toContain("confirmed");
  });

  it("charges the quoted price and nothing a request could name", () => {
    const allowed = authorisePurchase(
      { kind: "reveal", opportunityId: "o1" },
      { customer, permissionsHeld: EVERYTHING, owesUs: false, reveal: quoteReveal(context()) },
    );
    expect(allowed.allowed).toBe(true);
    expect(allowed.price.gross).toBe(revealPrice("owner-verified").standard);
  });
});

describe("the refund", () => {
  const PAID = fromMajor(99);
  const claim = (trigger: RefundTrigger, days: number) => ({
    trigger,
    paidAt: "2026-08-01T00:00:00.000Z",
    claimedAt: new Date(Date.parse("2026-08-01T00:00:00.000Z") + days * 86_400_000).toISOString(),
  });

  it("returns the whole fee on every trigger, with nobody to persuade", () => {
    for (const reason of REFUND_REASONS) {
      const decision = decideRefund(claim(reason.trigger, 3), PAID);
      expect(decision.refund, reason.trigger).toBe(true);
      expect(decision.amount, reason.trigger).toBe(PAID);
    }
  });

  it("never refunds a proportion", () => {
    // A partial refund is an argument about how much of an introduction was
    // delivered, and there is no honest way to settle it.
    const decision = decideRefund(claim("seller-unreachable", 1), PAID);
    expect(decision.amount === PAID || decision.amount === ZERO).toBe(true);
  });

  it("holds the window that was stated at the point of sale", () => {
    expect(decideRefund(claim("already-sold", REFUND_WINDOW_DAYS), PAID).refund).toBe(true);
    const late = decideRefund(claim("already-sold", REFUND_WINDOW_DAYS + 1), PAID);
    expect(late.refund).toBe(false);
    expect(late.amount).toBe(ZERO);
    expect(late.reason).toContain("stated at the point of sale");
  });

  it("refuses a claim dated before the payment rather than guessing", () => {
    const backwards = decideRefund(claim("not-for-sale", -2), PAID);
    expect(backwards.refund).toBe(false);
    expect(backwards.reason).toContain("one of the two is wrong");
  });

  it("promises in the guarantee exactly the windows the code applies", () => {
    // A guarantee published in marketing and applied by support eventually
    // differ, and the difference is always in our favour.
    const said = REVEAL_GUARANTEE.join(" ");
    expect(said).toContain(`${SELLER_RESPONSE_DAYS} days`);
    expect(said).toContain(`${REFUND_WINDOW_DAYS} days`);
    for (const reason of REFUND_REASONS) {
      expect(said.toLowerCase()).toContain(reason.label.split(" ")[0]?.toLowerCase() ?? "");
    }
  });
});

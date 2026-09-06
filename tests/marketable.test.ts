import { describe, expect, it } from "vitest";
import { fromMajor } from "@shared/money";
import { SEED_DEALS } from "@backend/store/seed";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { appraise } from "@shared/domain/economics";
import { classifyOpportunity, saleIsConfirmed } from "@shared/domain/inventory";
import { materialInformation } from "@shared/domain/materialInformation";
import { sellerDueDiligence } from "@shared/domain/sellerDueDiligence";
import { buyerPassport } from "@shared/domain/passport";
import { quoteReveal } from "@shared/domain/reveal";
import { heldKeys, readPermissions } from "@shared/domain/permissions";

/**
 * Can anything actually be sold?
 *
 * The question no test asked. Every gate had its own suite proving it refuses,
 * and all of them passed while the platform as a whole could not take a penny:
 * no screen recorded a sale confirmation, so `quoteReveal()` blocked every
 * opportunity however many permissions were held and however good the buyer.
 *
 * This is the end-to-end question, and it is deliberately phrased as "is there
 * at least one" rather than "does this one work" — a marketplace where nothing
 * is sellable is broken whatever the unit tests say.
 */

/**
 * The real clock, not a pinned one.
 *
 * The seed dates its confirmations and checks relative to load, so they never
 * lapse. A test pinned to midnight therefore sees evidence dated later the
 * same day and correctly refuses it as being in the future — which is the
 * freshness rule working, not a bug. Sharing the seed's clock is the fix.
 */
const NOW = new Date();

const EVERYTHING = heldKeys(
  readPermissions("estate-agency-aml:XAML00000000,redress-scheme:TPO-12345"),
);

/** A buyer who has been checked and can pay. */
const READY = (price: number) =>
  buyerPassport(
    {
      identityVerifiedAt: NOW.toISOString(),
      screenedAt: NOW.toISOString(),
      sourceOfFundsAt: NOW.toISOString(),
      completedPurchases: 3,
      proofOfFunds: {
        kind: "cash",
        evidencedAt: NOW.toISOString(),
        amount: fromMajor(999_999),
        issuer: "Lloyds",
      },
    },
    fromMajor(price),
    NOW,
  );

function quote(record: (typeof SEED_DEALS)[number]) {
  const inputs = toWorkingDeal(record.inputs).inputs;
  const property = appraise(inputs).inputs.property;
  const item = record.inventory ?? { category: "ai-discovered" as const };
  return quoteReveal({
    opportunity: classifyOpportunity(property, item),
    item,
    permissionsHeld: EVERYTHING,
    passport: READY(inputs.purchasePrice / 100),
    material: materialInformation(property, record.material ?? {}),
    sellerChecks: sellerDueDiligence(record.sellerChecks, NOW),
  });
}

describe("the marketplace can transact", () => {
  it("has at least one opportunity a checked buyer could actually open", () => {
    // Before the confirmation screen existed this was zero, and every
    // component test still passed.
    const sellable = SEED_DEALS.filter((d) => quote(d).chargeable);
    expect(sellable.length).toBeGreaterThan(0);
  });

  it("offers both routes in: an owner who asked, and an agent who authorised", () => {
    // The estate-agent proposition depends on the second one working.
    const categories = SEED_DEALS.filter((d) => quote(d).chargeable).map(
      (d) => d.inventory?.category,
    );
    expect(categories).toContain("owner-verified");
    expect(categories).toContain("agent-authorised");
  });
});

describe("and still refuses, for the right reasons", () => {
  it("refuses stock nobody has confirmed", () => {
    const unconfirmed = SEED_DEALS.filter((d) => !saleIsConfirmed(d.inventory));
    expect(unconfirmed.length).toBeGreaterThan(0);
    for (const deal of unconfirmed) {
      expect(quote(deal).chargeable, deal.reference).toBe(false);
    }
  });

  it("keeps a seeded deal that is refused by the material gate alone", () => {
    // The failure hardest to notice: confirmed, checked, and still unmarketable
    // because one Part A answer was never established. A seed in which
    // everything is complete demonstrates only the happy path.
    const confirmedButUnmarketable = SEED_DEALS.filter((d) => {
      if (!saleIsConfirmed(d.inventory)) return false;
      const inputs = toWorkingDeal(d.inputs).inputs;
      const property = appraise(inputs).inputs.property;
      return !materialInformation(property, d.material ?? {}).mayMarket;
    });
    expect(confirmedButUnmarketable.length).toBeGreaterThan(0);
    for (const deal of confirmedButUnmarketable) {
      expect(quote(deal).chargeable, deal.reference).toBe(false);
    }
  });
});

describe("a seller who asks is a seller who confirmed", () => {
  it("does not read an enquiry as nobody having said anything", () => {
    // `/sell` writes this shape. Storing a person who has just described their
    // situation and asked for help as "nobody has confirmed it is for sale"
    // was both untrue and the reason no enquiry could ever be sold.
    const fromEnquiry = {
      category: "owner-verified" as const,
      confirmation: {
        by: "owner" as const,
        at: NOW.toISOString(),
        recordedBy: "Seller enquiry form",
        evidence: 'Submitted their own property through the enquiry form, describing the situation as "probate".',
      },
    };
    expect(saleIsConfirmed(fromEnquiry)).toBe(true);
  });

  it("still does not let that stand in for checking who they are", () => {
    // The seller's word is a confirmation, not proof they are the registered
    // proprietor. That is a different question and it keeps its own gate.
    const inputs = toWorkingDeal(SEED_DEALS[0]!.inputs).inputs;
    const property = appraise(inputs).inputs.property;
    const unchecked = quoteReveal({
      opportunity: "owner-verified",
      item: {
        category: "owner-verified",
        confirmation: {
          by: "owner",
          at: NOW.toISOString(),
          recordedBy: "Seller enquiry form",
          evidence: "Submitted their own property.",
        },
      },
      permissionsHeld: EVERYTHING,
      passport: READY(172_000),
      material: materialInformation(property, {
        price: { state: "stated", value: "£172,000" },
        tenure: { state: "stated", value: "Freehold" },
        "council-tax": { state: "stated", value: "Band B" },
      }),
      sellerChecks: sellerDueDiligence(undefined, NOW),
    });
    expect(unchecked.chargeable).toBe(false);
    expect(unchecked.blockers.map((b) => b.reason).join(" ")).toContain("seller");
  });
});

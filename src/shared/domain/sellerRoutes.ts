import { add, applyBps, bps, fromMajor, money, pct, sub, ZERO, type Money } from "@shared/money";
import { appraise, maxViablePrice } from "@shared/domain/economics";
import { getJurisdiction } from "@shared/domain/jurisdictions";
import { diagnoseSeller, type SellerDiagnostics } from "@shared/domain/motivation";
import type {
  DealInputs,
  FinanceTerms,
  PropertyFacts,
  SellerProfile,
  StructureKind,
} from "@shared/domain/types";
import type { StructurePermission } from "@shared/domain/jurisdictions/types";

/**
 * Seller-facing routes.
 *
 * Every other engine in this system answers "what does the investor get?".
 * A seller needs the opposite: what do I receive, when, and what am I giving up
 * to get it? This module converts investor economics into that answer.
 *
 * Two rules it enforces:
 *
 *  1. A route is only offered if an investor can actually transact at that
 *     price. Quoting a seller a number no buyer would pay is the oldest trick
 *     in motivated-seller acquisition and the fastest way to lose a vendor at
 *     week six, having wasted the only asset they were short of — time.
 *
 *  2. Every route states its trade-off in the seller's own terms. A route that
 *     pays more but later is not "better"; it is different, and which is better
 *     depends on the problem they came here to solve.
 */

/** Investor margin required to justify a fast, certain, low-condition purchase. */
const FAST_CASH_TARGET_MARGIN_BPS = 2_000;
/** Investor margin required on a slower purchase with more work involved. */
const STRUCTURED_TARGET_MARGIN_BPS = 1_200;
/** Share of the price a deferred structure typically pays on completion. */
const DEFERRED_UPFRONT_BPS = pct(60);
/** Months over which the deferred balance is paid. */
const DEFERRED_MONTHS = 18;
/** Investor's required return on an assisted sale, against money they risk. */
const ASSISTED_SALE_RETURN_BPS = pct(25);

const STANDARD_FINANCE: FinanceTerms = {
  ltvBps: pct(70),
  refurbAdvanceBps: pct(100),
  annualRateBps: pct(9.6),
  arrangementFeeBps: pct(2),
  exitFeeBps: pct(1),
  interestRolledUp: true,
  lenderCosts: fromMajor(1_500),
};

const CASH_FINANCE: FinanceTerms = {
  ltvBps: pct(0),
  refurbAdvanceBps: pct(0),
  annualRateBps: pct(0),
  arrangementFeeBps: pct(0),
  exitFeeBps: pct(0),
  interestRolledUp: false,
  lenderCosts: ZERO,
};

export type RouteCertainty = "high" | "medium" | "conditional";

/** How precisely the platform can model this route's cash flows. */
export type RouteFidelity = "modelled" | "indicative";

export interface SellerRoute {
  readonly key: string;
  readonly label: string;
  readonly structure: StructureKind;
  /** Total consideration to the seller across all payments. */
  readonly totalToSeller: Money;
  /** Paid on completion. */
  readonly upfront: Money;
  /** Paid later, if any. */
  readonly deferred: Money;
  readonly deferredOverMonths?: number;
  readonly completionDaysMin: number;
  readonly completionDaysMax: number;
  readonly certainty: RouteCertainty;
  readonly fidelity: RouteFidelity;
  readonly permission: StructurePermission;
  /** Plain-language summary of what the seller is agreeing to. */
  readonly summary: string;
  /** What the seller gives up to get this. Never empty. */
  readonly tradeOffs: readonly string[];
  /** Safeguards required before this route can proceed. */
  readonly requires: readonly string[];
  /** 0-100, how well this fits the priorities the seller stated. */
  readonly fit: number;
  /** True where this route is unavailable and is shown only as context. */
  readonly unavailable: boolean;
  readonly unavailableReason?: string;
}

export interface SellerRoutesReport {
  readonly routes: readonly SellerRoute[];
  readonly best?: SellerRoute;
  /** Routes that could not be offered here, with reasons. */
  readonly unavailable: readonly SellerRoute[];
  readonly diagnostics: SellerDiagnostics;
  /** True where no route pays enough to interest any investor. */
  readonly noViableRoute: boolean;
  readonly summary: string;
}

function baseInputs(
  property: PropertyFacts,
  seller: SellerProfile,
  overrides: Partial<DealInputs>,
): DealInputs {
  return {
    property,
    seller,
    purchasePrice: property.openMarketValue,
    buyerOwnsOtherProperty: true,
    buyerIsCompany: true,
    buyerIsNonResident: false,
    holdMonths: 9,
    structure: "cash-purchase",
    finance: CASH_FINANCE,
    exit: "sell",
    ...overrides,
  };
}

export function buildSellerRoutes(
  property: PropertyFacts,
  seller: SellerProfile,
): SellerRoutesReport {
  const pack = getJurisdiction(property.jurisdiction);
  const diagnostics = diagnoseSeller(seller, property);
  const routes: SellerRoute[] = [];

  // --- Route A: fast cash -------------------------------------------------
  // A cash buyer carries no lender, so completion is limited by searches and
  // the seller's own solicitor rather than by an underwriter. They price that
  // speed and certainty into a wider margin, which is why this pays least.
  const fastInputs = baseInputs(property, seller, {
    structure: "cash-purchase",
    exit: "sell",
    holdMonths: 6,
    finance: CASH_FINANCE,
  });
  const fastPrice = maxViablePrice(fastInputs, FAST_CASH_TARGET_MARGIN_BPS);
  const fastRuling = pack.structureStatus("cash-purchase");

  routes.push({
    key: "fast-cash",
    label: "Fast cash purchase",
    structure: "cash-purchase",
    totalToSeller: fastPrice,
    upfront: fastPrice,
    deferred: ZERO,
    completionDaysMin: 7,
    completionDaysMax: 21,
    certainty: "high",
    fidelity: "modelled",
    permission: fastRuling.permission,
    summary:
      "A cash buyer purchases the property as it stands. No mortgage, no chain, no viewings, and you do no work to it.",
    tradeOffs: [
      "This is the lowest of the figures shown. You are being paid for speed and certainty, not for the property's full open-market value.",
      "The buyer takes the risk that the property is worse than it looks, and prices that in.",
    ],
    requires: fastRuling.requires,
    fit: scoreFit({ speed: 95, certainty: 95, convenience: 90, price: 20, flexibility: 40 }, seller),
    unavailable: fastPrice <= 0,
    ...(fastPrice <= 0
      ? { unavailableReason: "No cash buyer can transact at a price that works for them on these figures." }
      : {}),
  });

  // --- Route B: structured purchase, higher price -------------------------
  // A buyer using finance and taking longer can accept a thinner margin, so
  // they can pay more. The seller trades completion speed for consideration.
  const structuredInputs = baseInputs(property, seller, {
    structure: "bridging-refurb-refinance",
    exit: "refinance-and-hold",
    holdMonths: 9,
    finance: STANDARD_FINANCE,
  });
  const structuredPrice = maxViablePrice(structuredInputs, STRUCTURED_TARGET_MARGIN_BPS);
  const structuredRuling = pack.structureStatus("bridging-refurb-refinance");

  routes.push({
    key: "structured",
    label: "Higher price, flexible completion",
    structure: "bridging-refurb-refinance",
    totalToSeller: structuredPrice,
    upfront: structuredPrice,
    deferred: ZERO,
    completionDaysMin: 30,
    completionDaysMax: 90,
    certainty: "medium",
    fidelity: "modelled",
    permission: structuredRuling.permission,
    summary:
      "A funded buyer purchases the property and refurbishes it. Because they are working to a longer timetable and a thinner margin, they can pay more than a cash buyer.",
    tradeOffs: [
      "Completion depends on the buyer's lender, so it is slower and less certain than cash.",
      "A lender's valuation or survey can change the price late in the process.",
    ],
    requires: structuredRuling.requires,
    fit: scoreFit({ speed: 35, certainty: 55, convenience: 70, price: 75, flexibility: 60 }, seller),
    unavailable: structuredPrice <= 0,
    ...(structuredPrice <= 0
      ? { unavailableReason: "The works and finance costs leave no margin at any price a buyer would pay." }
      : {}),
  });

  // --- Route C: deferred consideration ------------------------------------
  // Paying part of the price later reduces the buyer's day-one capital and the
  // interest they carry, so they can offer more in total. The seller becomes a
  // creditor for the balance, which is the real cost of the extra money.
  const deferredRuling = pack.structureStatus("deferred-consideration");
  if (deferredRuling.permission !== "not-supported" && structuredPrice > 0) {
    const deferredShareBps = bps(pct(100) - DEFERRED_UPFRONT_BPS);
    const deferredPortion = applyBps(structuredPrice, deferredShareBps);
    // The uplift is the financing the buyer no longer has to pay for on the
    // deferred slice over the deferral period. Approximate and flagged as such.
    const uplift = money(
      Math.round(
        (deferredPortion * STANDARD_FINANCE.annualRateBps * DEFERRED_MONTHS) / (10_000 * 12),
      ),
    );
    const total = add(structuredPrice, uplift);
    const upfront = applyBps(total, DEFERRED_UPFRONT_BPS);

    routes.push({
      key: "deferred",
      label: "Part now, the rest later",
      structure: "deferred-consideration",
      totalToSeller: total,
      upfront,
      deferred: sub(total, upfront),
      deferredOverMonths: DEFERRED_MONTHS,
      completionDaysMin: 30,
      completionDaysMax: 60,
      certainty: "conditional",
      fidelity: "indicative",
      permission: deferredRuling.permission,
      summary:
        "You receive most of the money on completion and the balance over an agreed period. Because the buyer's capital is freed up, the total is higher than a straight sale.",
      tradeOffs: [
        "You are owed money by the buyer after completion. If they fail to pay, you are a creditor — you must hold security and take legal advice on it.",
        "The higher total is only worth having if you do not need all the money now.",
        "These figures are indicative. The exact split and security must be negotiated and documented.",
      ],
      requires: deferredRuling.requires,
      fit: scoreFit({ speed: 45, certainty: 25, convenience: 60, price: 85, flexibility: 90 }, seller),
      unavailable: false,
    });
  }

  // --- Route D: assisted sale ---------------------------------------------
  // The route for a seller whose minimum exceeds what any investor can pay to
  // own the asset. Nobody buys it; a partner funds and manages the works, the
  // property sells at full value, and the seller takes an agreed sum from the
  // proceeds.
  const assistedRuling = pack.structureStatus("assisted-sale");
  if (assistedRuling.permission !== "not-supported") {
    const worksAndCosts = add(
      property.refurbishmentEstimate,
      applyBps(property.refurbishmentEstimate, pack.defaults.contingencyBps),
    );
    const sellingCosts = add(
      applyBps(property.postWorksValue, pack.defaults.sellingAgentBps),
      pack.defaults.sellerLegalOnExit,
    );
    const investorReturn = applyBps(worksAndCosts, ASSISTED_SALE_RETURN_BPS);
    const toSeller = sub(
      property.postWorksValue,
      add(worksAndCosts, sellingCosts, investorReturn),
    );

    const beatsOwnership = toSeller > structuredPrice && toSeller > fastPrice;

    routes.push({
      key: "assisted-sale",
      label: "Improve first, then sell",
      structure: "assisted-sale",
      totalToSeller: toSeller,
      upfront: ZERO,
      deferred: toSeller,
      deferredOverMonths: 9,
      completionDaysMin: 150,
      completionDaysMax: 300,
      certainty: "conditional",
      fidelity: "indicative",
      permission: assistedRuling.permission,
      summary:
        "You keep ownership. A partner funds and manages the refurbishment, the property is then sold on the open market, and you receive an agreed sum from the proceeds. This usually produces the highest figure.",
      tradeOffs: [
        "You are paid at the end, not at the start. If you need money now, this route cannot solve that.",
        "You still own the property while the work happens, with the obligations that carries.",
        "If the property sells for less than projected, the amount you receive can change unless it is contractually fixed.",
        "These figures are indicative and depend on the works estimate being right.",
      ],
      requires: assistedRuling.requires,
      fit: scoreFit(
        { speed: 5, certainty: 20, convenience: 35, price: 100, flexibility: 70 },
        seller,
      ) + (beatsOwnership ? 10 : 0),
      unavailable: toSeller <= 0,
      ...(toSeller <= 0
        ? { unavailableReason: "The works cost more than the improvement they would create." }
        : {}),
    });
  }

  const available = routes.filter((r) => !r.unavailable);
  const unavailable = routes.filter((r) => r.unavailable);

  // Rank by fit against what the seller said they wanted, not by price. A
  // seller who needs completion in three weeks is not served by the biggest
  // number on the page, and ordering by price would quietly tell them otherwise.
  const ranked = [...available].sort((a, b) => b.fit - a.fit);

  const noViableRoute = available.length === 0;

  return {
    routes: ranked,
    best: ranked[0],
    unavailable,
    diagnostics,
    noViableRoute,
    summary: noViableRoute
      ? "On the figures given, no route produces an outcome an investor could transact on. An ordinary open-market sale is likely to serve you better."
      : `${available.length} route${available.length === 1 ? "" : "s"} available, ranked against the priorities you told us — not by which pays most.`,
  };
}

/**
 * Score a route against the seller's stated priorities.
 *
 * The weights describe how well a route serves each priority. A seller who
 * named no priorities gets a neutral score, so the ranking falls back to the
 * order the routes were generated in rather than inventing a preference.
 */
function scoreFit(
  profile: Record<string, number>,
  seller: SellerProfile,
): number {
  if (seller.priorities.length === 0) return 50;
  const total = seller.priorities.reduce((sum, p) => sum + (profile[p] ?? 50), 0);
  return Math.round(total / seller.priorities.length);
}

/**
 * What an investor would actually make on the route, for the disclosure that
 * tells the seller the buyer's projected profit.
 *
 * Consumer protection rules require material information to be disclosed, and
 * the buyer's intended profit is material. This is the number that goes on the
 * page next to the offer.
 */
export function investorProfitOnRoute(
  property: PropertyFacts,
  seller: SellerProfile,
  route: SellerRoute,
): Money {
  if (route.unavailable || route.totalToSeller <= 0) return ZERO;

  if (route.structure === "assisted-sale") {
    const pack = getJurisdiction(property.jurisdiction);
    return applyBps(
      add(
        property.refurbishmentEstimate,
        applyBps(property.refurbishmentEstimate, pack.defaults.contingencyBps),
      ),
      ASSISTED_SALE_RETURN_BPS,
    );
  }

  const inputs = baseInputs(property, seller, {
    purchasePrice: route.totalToSeller,
    structure: route.structure === "deferred-consideration" ? "cash-purchase" : route.structure,
    exit: route.structure === "cash-purchase" ? "sell" : "refinance-and-hold",
    holdMonths: route.structure === "cash-purchase" ? 6 : 9,
    finance: route.structure === "cash-purchase" ? CASH_FINANCE : STANDARD_FINANCE,
  });
  return appraise(inputs).profit;
}

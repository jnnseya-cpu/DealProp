import { applyBps, fromMajor, money, pct, scale, sub, ZERO, type Bps, type Money } from "@shared/money";
import { gbp, percent } from "@shared/format";

/**
 * The chargeable catalogue: every price this platform may ask anybody for.
 *
 * One place, because a price that exists in two places eventually disagrees
 * with itself, and the version the customer sees is never the version that
 * loses the argument. `revenue.ts` models the business; this is what may
 * actually be charged, and the landing page renders from here through it.
 *
 * Three rules hold everywhere below.
 *
 * **Money is a whole number of pence.** No plan price, credit pack, tax figure
 * or operation cost is ever a float. Rounding happens once, explicitly, at the
 * point tax is applied.
 *
 * **The price the customer is charged is the price this file states.** Nothing
 * is ever taken from a request. A checkout that accepts an amount from the
 * browser is a checkout where the amount is zero, and it is the single most
 * common way a platform is charged nothing for something that cost it money.
 *
 * **Tax is decided before the sale, not after.** Under-collecting VAT is not a
 * customer problem; the liability is ours and it is paid out of margin. Where
 * the correct treatment is not implemented, the sale is refused rather than
 * guessed at.
 */

/* ------------------------------------------------------------------- tax */

/**
 * UK VAT on digital services.
 *
 * Dated, like every other rate in this codebase, because a rate with no date is
 * a rate nobody can check. 20% has been the standard rate since January 2011.
 */
export const UK_VAT = {
  asOf: "2026-08-25",
  standardRateBps: 2_000,
  citation: "VAT Act 1994 s.2; standard rate 20% since 4 January 2011",
} as const;

export type CustomerKind = "consumer" | "business";

export interface CustomerTaxProfile {
  /** ISO 3166-1 alpha-2, upper case. */
  readonly country: string;
  readonly kind: CustomerKind;
  /** An EU or UK VAT registration, where the customer has given one. */
  readonly vatNumber?: string;
}

export type TaxTreatment =
  /** UK VAT charged at the standard rate. */
  | "uk-vat"
  /** EU business with a VAT number: the customer accounts for it, we charge 0%. */
  | "reverse-charge"
  /** Outside the scope of UK VAT. */
  | "outside-scope"
  /** We do not know how to charge this lawfully. The sale must not proceed. */
  | "not-supported";

export interface TaxDecision {
  readonly treatment: TaxTreatment;
  readonly rateBps: number;
  readonly mayCharge: boolean;
  /** Always populated. No silent tax decisions. */
  readonly reason: string;
}

/** EU member states, for the place-of-supply rules below. */
const EU: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

/**
 * What tax to charge, and whether the sale may happen at all.
 *
 * The direction of every uncertainty here is the same: refuse rather than
 * guess. An unlawful sale is not revenue — it is revenue we have to give back,
 * having already paid the cost of delivering it.
 *
 * The gap this deliberately does not paper over is non-UK consumers. Selling a
 * digital service to a consumer in the EU means charging their country's rate
 * and remitting it through One Stop Shop registration, and to a consumer in
 * much of the rest of the world means a local digital services registration.
 * Neither exists yet, so neither sale is allowed to complete. Charging UK VAT
 * to a French consumer would be wrong in both directions at once: we would
 * remit tax to the wrong state and still owe France.
 */
export function taxDecision(profile: CustomerTaxProfile): TaxDecision {
  const country = profile.country.trim().toUpperCase();

  if (country === "GB") {
    return {
      treatment: "uk-vat",
      rateBps: UK_VAT.standardRateBps,
      mayCharge: true,
      reason: `UK customer: VAT at the standard rate (${UK_VAT.citation}).`,
    };
  }

  if (EU.has(country) && profile.kind === "business") {
    const vat = (profile.vatNumber ?? "").replace(/\s/g, "");
    if (vat === "") {
      return {
        treatment: "not-supported",
        rateBps: 0,
        mayCharge: false,
        reason:
          "An EU business without a VAT number is treated as a consumer for place-of-supply purposes, and consumer sales outside the UK are not supported yet.",
      };
    }
    return {
      treatment: "reverse-charge",
      rateBps: 0,
      mayCharge: true,
      reason: `EU business with VAT number ${vat}: the customer accounts for VAT under the reverse charge. The number must be validated before the invoice is issued.`,
    };
  }

  if (profile.kind === "business") {
    return {
      treatment: "outside-scope",
      rateBps: 0,
      mayCharge: true,
      reason: `Business customer in ${country}: outside the scope of UK VAT. Check whether ${country} requires a local registration before selling at volume.`,
    };
  }

  return {
    treatment: "not-supported",
    rateBps: 0,
    mayCharge: false,
    reason: `Consumer in ${country}. Selling a digital service to a consumer outside the UK requires registration in their country — One Stop Shop within the EU. Until that exists the sale must be refused rather than charged the wrong rate.`,
  };
}

/* ---------------------------------------------------------------- prices */

/**
 * Whether a stated price already contains tax.
 *
 * Consumer-facing prices are advertised inclusive, because UK consumer
 * protection rules require the price a consumer sees to be the price they pay.
 * Business prices are quoted exclusive, which is the convention and what a
 * finance department expects on a purchase order. Getting this backwards is a
 * silent 20% margin loss on every consumer sale, which is exactly why it is a
 * field rather than an assumption.
 */
export type TaxTreatmentOfPrice = "inclusive" | "exclusive";

export interface PriceBreakdown {
  /** What leaves the customer's account. */
  readonly gross: Money;
  /** What we keep before costs. */
  readonly net: Money;
  readonly tax: Money;
  readonly rateBps: number;
  readonly treatment: TaxTreatment;
}

/**
 * Split a catalogue price into net, tax and gross.
 *
 * Tax is computed once and rounded once. Deriving net by subtraction rather
 * than by a second rounding is deliberate: rounding both halves independently
 * lets them fail to add up to the total charged, and a penny that does not
 * reconcile costs more to investigate than it is worth.
 */
export function priceBreakdown(
  price: Money,
  statedAs: TaxTreatmentOfPrice,
  tax: TaxDecision,
): PriceBreakdown {
  if (tax.rateBps === 0) {
    return { gross: price, net: price, tax: ZERO, rateBps: 0, treatment: tax.treatment };
  }

  const rate = tax.rateBps / 10_000;

  if (statedAs === "inclusive") {
    const net = money(Math.round(price / (1 + rate)));
    return {
      gross: price,
      net,
      tax: sub(price, net),
      rateBps: tax.rateBps,
      treatment: tax.treatment,
    };
  }

  const taxAmount = scale(price, rate);
  return {
    gross: money(price + taxAmount),
    net: price,
    tax: taxAmount,
    rateBps: tax.rateBps,
    treatment: tax.treatment,
  };
}

/* ----------------------------------------------------------------- plans */

export type PlanId =
  | "buyer-explorer"
  | "buyer-investor"
  | "buyer-dealmaker"
  | "buyer-professional"
  | "buyer-business"
  | "funder-private"
  | "funder-professional"
  | "funder-institutional";

export type PlanAudience = "buyer" | "funder";

/**
 * What a plan actually entitles somebody to.
 *
 * Numbers rather than adjectives. "Unlimited" is a value the type system
 * understands, not a marketing word that a limit check has to interpret.
 *
 * These are the numbers enforced on the server. A feature listed in marketing
 * copy and absent here is not sold, and a limit here that no code checks is a
 * limit that does not exist — `entitlements.ts` is where they are applied and
 * every one of them is tested.
 */
export interface PlanLimits {
  readonly maxBuyBoxes: number | "unlimited";
  readonly maxFundingBoxes: number | "unlimited";
  /**
   * Memoranda openable per billing period.
   *
   * The memorandum is the product. Without a cap, one month of the cheapest
   * plan that includes them buys the entire library, which is a subscription
   * that pays for itself once and then costs us every month it is not renewed.
   */
  readonly memorandaPerPeriod: number;
  /** Credit balance granted at the start of each paid period. Never rolls over. */
  readonly periodCredits: Money;
  readonly seats: number;
  readonly apiAccess: boolean;
  readonly fullDealScore: boolean;
  readonly strategyRouter: boolean;
  readonly redTeam: boolean;
  readonly capitalStack: boolean;
  readonly goldmine: boolean;
  readonly dealRooms: boolean;
  readonly fundingMatching: boolean;
}

export interface Plan {
  readonly id: PlanId;
  readonly audience: PlanAudience;
  readonly name: string;
  readonly summary: string;
  /** Per month, in pence, as stated by `statedAs`. */
  readonly price: Money;
  readonly statedAs: TaxTreatmentOfPrice;
  readonly features: readonly string[];
  readonly limits: PlanLimits;
}

const NOTHING: PlanLimits = {
  maxBuyBoxes: 0,
  maxFundingBoxes: 0,
  memorandaPerPeriod: 0,
  periodCredits: ZERO,
  seats: 1,
  apiAccess: false,
  fullDealScore: false,
  strategyRouter: false,
  redTeam: false,
  capitalStack: false,
  goldmine: false,
  dealRooms: false,
  fundingMatching: false,
};

export const PLANS: readonly Plan[] = [
  {
    id: "buyer-explorer",
    audience: "buyer",
    name: "Explorer",
    summary: "See that opportunities exist.",
    price: ZERO,
    statedAs: "inclusive",
    features: ["Limited opportunity browsing", "One Buy Box", "Deal Score headline only"],
    limits: { ...NOTHING, maxBuyBoxes: 1 },
  },
  {
    id: "buyer-investor",
    audience: "buyer",
    name: "Investor",
    summary: "Deal alerts and full search.",
    price: fromMajor(39),
    statedAs: "inclusive",
    features: ["Full opportunity search", "Three Buy Boxes", "Deal alerts", "Full Deal Score breakdown"],
    limits: { ...NOTHING, maxBuyBoxes: 3, fullDealScore: true },
  },
  {
    id: "buyer-dealmaker",
    audience: "buyer",
    name: "Acquisition",
    summary: "Analysis, structuring and negotiation.",
    price: fromMajor(129),
    statedAs: "inclusive",
    features: ["Strategy Router", "Red Team stress testing", "Capital Stack builder", "GoldMine access", "Monthly AI credits"],
    limits: {
      ...NOTHING,
      maxBuyBoxes: 5,
      fullDealScore: true,
      strategyRouter: true,
      redTeam: true,
      capitalStack: true,
      goldmine: true,
      periodCredits: fromMajor(25),
    },
  },
  {
    id: "buyer-professional",
    audience: "buyer",
    name: "Professional",
    summary: "Funding matching and Deal Rooms.",
    price: fromMajor(399),
    statedAs: "inclusive",
    features: ["Funding Box matching", "Unlimited Buy Boxes", "Deal Rooms", "Investment memoranda", "Priority support"],
    limits: {
      ...NOTHING,
      maxBuyBoxes: "unlimited",
      fullDealScore: true,
      strategyRouter: true,
      redTeam: true,
      capitalStack: true,
      goldmine: true,
      dealRooms: true,
      fundingMatching: true,
      memorandaPerPeriod: 20,
      periodCredits: fromMajor(75),
    },
  },
  {
    id: "buyer-business",
    audience: "buyer",
    name: "Business",
    summary: "Teams, automation and API.",
    price: fromMajor(1_500),
    statedAs: "exclusive",
    features: ["Team accounts", "Portfolio sourcing", "API access", "Custom underwriting rules"],
    limits: {
      ...NOTHING,
      maxBuyBoxes: "unlimited",
      fullDealScore: true,
      strategyRouter: true,
      redTeam: true,
      capitalStack: true,
      goldmine: true,
      dealRooms: true,
      fundingMatching: true,
      memorandaPerPeriod: 100,
      periodCredits: fromMajor(200),
      seats: 5,
      apiAccess: true,
    },
  },
  {
    id: "funder-private",
    audience: "funder",
    name: "Private lender",
    summary: "Matched deal flow.",
    price: fromMajor(299),
    statedAs: "exclusive",
    features: ["Two Funding Boxes", "Matched deals", "Deal Room access"],
    limits: { ...NOTHING, maxFundingBoxes: 2, dealRooms: true, memorandaPerPeriod: 10 },
  },
  {
    id: "funder-professional",
    audience: "funder",
    name: "Professional",
    summary: "Underwriting workflow.",
    price: fromMajor(999),
    statedAs: "exclusive",
    features: ["Unlimited Funding Boxes", "AI underwriting summaries", "Portfolio view"],
    limits: {
      ...NOTHING,
      maxFundingBoxes: "unlimited",
      dealRooms: true,
      memorandaPerPeriod: 50,
      periodCredits: fromMajor(100),
    },
  },
  {
    id: "funder-institutional",
    audience: "funder",
    name: "Institutional",
    summary: "Origination pipeline.",
    price: fromMajor(2_500),
    statedAs: "exclusive",
    features: ["API access", "Custom mandate logic", "Dedicated origination"],
    limits: {
      ...NOTHING,
      maxFundingBoxes: "unlimited",
      dealRooms: true,
      memorandaPerPeriod: 200,
      periodCredits: fromMajor(250),
      seats: 10,
      apiAccess: true,
    },
  },
];

export function plan(id: PlanId): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

/** The plan somebody has when they are paying nothing. */
export const FREE_PLAN_ID: PlanId = "buyer-explorer";

/* --------------------------------------------------------- credit topups */

/**
 * Prepaid balance, denominated in pence rather than in "credits".
 *
 * A unit called a credit has to have a price, and a price that changes creates
 * an arbitrage: buy at the old rate, hold, spend at the new one. Denominating
 * the balance in money removes the arbitrage entirely — a top-up of £50 buys
 * fifty pounds of usage whenever it is spent, and repricing an operation
 * reprices it for everyone at once.
 */
/* ------------------------------------------------- the marketplace model */

/**
 * The five stages a transaction earns at.
 *
 * The point of the model is that one completed property produces several
 * revenue events rather than one, so a deal that dies at stage three has still
 * paid for the work done up to it. The seller pays at exactly one of them, and
 * it is the last.
 */
export type RevenueStage = "discovery" | "analysis" | "negotiation" | "services" | "completion";

/**
 * What kind of opportunity is being unlocked.
 *
 * Reveal is priced by what the pack is worth to a buyer, not by what the
 * property is worth — a land opportunity takes an order of magnitude more
 * verification than a three-bed terrace, and that is what is being sold.
 */
export type OpportunityClass =
  | "standard-residential"
  | "owner-verified"
  | "vacant-refurbishment"
  | "hmo-mixed-use"
  | "small-development"
  | "commercial"
  | "land"
  | "portfolio";

export interface RevealPrice {
  readonly opportunity: OpportunityClass;
  readonly label: string;
  /** The floor and ceiling of the band, so a page can state a range honestly. */
  readonly from: Money;
  readonly to: Money;
  /** What is actually charged unless an operator prices the opportunity itself. */
  readonly standard: Money;
}

/**
 * Reveal prices.
 *
 * The fee buys a verified opportunity pack, a controlled introduction and the
 * transaction intelligence around it. It does not buy an address: charging to
 * unlock a telephone number that is already on a portal is the thing that makes
 * a buyer feel cheated the first time they check, and it is prohibited outright
 * in the specification's own list of what not to do.
 */
export const REVEAL_PRICES: readonly RevealPrice[] = [
  { opportunity: "standard-residential", label: "Standard residential", from: fromMajor(29), to: fromMajor(49), standard: fromMajor(39) },
  { opportunity: "owner-verified", label: "Owner-verified motivated seller", from: fromMajor(79), to: fromMajor(149), standard: fromMajor(99) },
  { opportunity: "vacant-refurbishment", label: "Vacant or refurbishment", from: fromMajor(99), to: fromMajor(199), standard: fromMajor(149) },
  { opportunity: "hmo-mixed-use", label: "HMO or small mixed-use", from: fromMajor(149), to: fromMajor(299), standard: fromMajor(199) },
  { opportunity: "small-development", label: "Small development", from: fromMajor(249), to: fromMajor(499), standard: fromMajor(349) },
  { opportunity: "commercial", label: "Commercial", from: fromMajor(299), to: fromMajor(750), standard: fromMajor(495) },
  { opportunity: "land", label: "Land", from: fromMajor(399), to: fromMajor(1_500), standard: fromMajor(750) },
  { opportunity: "portfolio", label: "Portfolio disposal", from: fromMajor(750), to: fromMajor(2_500), standard: fromMajor(1_250) },
];

export function revealPrice(opportunity: OpportunityClass): RevealPrice {
  const found = REVEAL_PRICES.find((r) => r.opportunity === opportunity);
  if (found === undefined) throw new Error(`No reveal price for "${opportunity}".`);
  return found;
}

/**
 * Acquisition Credit Units.
 *
 * Platform units rather than exposed model tokens, so the provider behind an
 * analysis can change without repricing the product. They are still money: an
 * ACU is bought with cash, sits in the same append-only ledger as everything
 * else, and a bonus lot has no cash behind it and can never be refunded out.
 *
 * `pence` is what one ACU cost at the headline package, and exists so a page
 * can show a function's cost in real money rather than in a currency the reader
 * has to learn before they can judge whether it is dear.
 */
export const ACU_HEADLINE_PENCE = 10;

export interface AcuPackage {
  readonly id: string;
  readonly name: string;
  readonly price: Money;
  readonly acus: number;
  readonly statedAs: TaxTreatmentOfPrice;
}

export const ACU_PACKAGES: readonly AcuPackage[] = [
  { id: "acu-trial", name: "Trial", price: ZERO, acus: 30, statedAs: "inclusive" },
  { id: "acu-starter", name: "Starter", price: fromMajor(10), acus: 100, statedAs: "inclusive" },
  { id: "acu-investor", name: "Investor", price: fromMajor(45), acus: 500, statedAs: "inclusive" },
  { id: "acu-acquisition", name: "Acquisition", price: fromMajor(160), acus: 2_000, statedAs: "inclusive" },
  { id: "acu-professional", name: "Professional", price: fromMajor(650), acus: 10_000, statedAs: "inclusive" },
];

export function acuPackage(id: string): AcuPackage | undefined {
  return ACU_PACKAGES.find((p) => p.id === id);
}

export type AcuFunction =
  | "quick-score"
  | "comparable-sales"
  | "rental-yield"
  | "refurbishment-estimate"
  | "planning-potential"
  | "title-risk"
  | "full-appraisal"
  | "offer-strategy"
  | "seller-questions"
  | "negotiation-round"
  | "negotiation-mandate"
  | "development-residual"
  | "finance-comparison"
  | "portfolio-impact"
  | "transaction-monitoring"
  | "investment-committee-report";

/**
 * What each analysis costs in ACUs.
 *
 * The negotiation mandate is a range in the specification because its cost
 * depends on how many rounds it runs. It is priced here at its floor and each
 * round is charged as it happens, so a buyer is never billed for negotiation
 * that did not take place.
 */
export const ACU_COSTS: Record<AcuFunction, number> = {
  "quick-score": 3,
  "comparable-sales": 10,
  "rental-yield": 8,
  "refurbishment-estimate": 15,
  "planning-potential": 20,
  "title-risk": 20,
  "full-appraisal": 30,
  "offer-strategy": 12,
  "seller-questions": 5,
  "negotiation-round": 15,
  "negotiation-mandate": 75,
  "development-residual": 50,
  "finance-comparison": 15,
  "portfolio-impact": 25,
  "transaction-monitoring": 5,
  "investment-committee-report": 75,
};

export function acuCost(fn: AcuFunction): number {
  return ACU_COSTS[fn];
}

/** An ACU cost in money, so a page can show both. */
export function acuAsMoney(acus: number): Money {
  return money(acus * ACU_HEADLINE_PENCE);
}

/**
 * The seller's success fee.
 *
 * The one charge the seller pays, and only on completion. Banded with a floor
 * and a ceiling because a percentage alone is wrong at both ends: 0.60% of a
 * £90,000 terrace does not cover the work, and 0.60% of a £2m portfolio is a
 * number nobody would agree to.
 */
export type SellerService = "standard" | "managed";

export interface SuccessFeeBand {
  readonly service: SellerService;
  readonly label: string;
  readonly rateBps: Bps;
  readonly minimum: Money;
  /** Undefined where the fee is negotiated rather than capped. */
  readonly maximum?: Money;
  readonly includes: readonly string[];
}

export const SUCCESS_FEE_BANDS: readonly SuccessFeeBand[] = [
  {
    service: "standard",
    label: "Standard sale",
    rateBps: pct(0.6),
    minimum: fromMajor(1_250),
    maximum: fromMajor(7_500),
    includes: [
      "Buyer identity and funding verification",
      "Offer comparison and structured negotiation",
      "Transaction progression to completion",
    ],
  },
  {
    service: "managed",
    label: "AI-managed premium sale",
    rateBps: pct(1),
    minimum: fromMajor(2_500),
    includes: [
      "Everything in the standard sale",
      "Human-reviewed negotiation",
      "Reserve-buyer management if the transaction fails",
    ],
  },
];

export function successFeeBand(service: SellerService): SuccessFeeBand {
  const found = SUCCESS_FEE_BANDS.find((b) => b.service === service);
  if (found === undefined) throw new Error(`No success fee band for "${service}".`);
  return found;
}

/**
 * The seller's fee on a completed sale.
 *
 * Computed here and nowhere else. The floor and the ceiling are applied after
 * the percentage, in that order, so a small sale pays the minimum and a large
 * one pays the cap rather than the percentage.
 */
export function successFee(salePrice: Money, service: SellerService): Money {
  const band = successFeeBand(service);
  const percentage = applyBps(salePrice, band.rateBps);
  const floored = percentage < band.minimum ? band.minimum : percentage;
  if (band.maximum === undefined) return floored;
  return floored > band.maximum ? band.maximum : floored;
}

/**
 * The seller's headline, in one sentence, stated from the band.
 *
 * Exists so no page has to restate a rate or a floor. A percentage published
 * on a landing page and charged at a different one is a refund and a
 * complaint, and the version the seller read is never the one that loses.
 */
export function sellerFeeHeadline(service: SellerService = "standard"): string {
  const band = successFeeBand(service);
  const floor = `minimum ${gbp(band.minimum)}`;
  const cap = band.maximum === undefined ? "" : `, capped at ${gbp(band.maximum)}`;
  return `${percent(band.rateBps, 2)} of the price achieved, ${floor}${cap}`;
}

/**
 * What a service provider pays when the platform wins them the work.
 *
 * Deliberately not one rate. A conveyancer's fee is largely fixed and a
 * percentage of it is a rounding error to us and an irritation to them; a
 * contractor's job is large and variable and a percentage is the only thing
 * that scales. `fixed` and `rateBps` are exclusive — one or the other, never
 * both, so nobody has to work out which applied.
 */
export type ProviderKind =
  | "conveyancer"
  | "surveyor"
  | "structural-engineer"
  | "valuer"
  | "epc-assessor"
  | "photographer"
  | "contractor"
  | "removals"
  | "property-manager"
  | "letting-agent"
  | "auctioneer"
  | "broker"
  | "insurance"
  | "utilities";

export interface ProviderCommission {
  readonly kind: ProviderKind;
  readonly label: string;
  /** A fixed fee per completed instruction, in pence. */
  readonly fixed?: Money;
  /** A share of what the provider is paid. */
  readonly rateBps?: Bps;
  readonly basis: string;
  /**
   * True where the arrangement itself needs an authorisation before any money
   * changes hands. A broker referral is a regulated introduction; a removals
   * commission is not.
   */
  readonly requiresAuthorisedArrangement: boolean;
}

export const PROVIDER_COMMISSIONS: readonly ProviderCommission[] = [
  { kind: "conveyancer", label: "Conveyancer", fixed: fromMajor(200), basis: "Per completed instruction.", requiresAuthorisedArrangement: false },
  { kind: "surveyor", label: "Surveyor", rateBps: pct(10), basis: "Of the fee the surveyor is paid.", requiresAuthorisedArrangement: false },
  { kind: "structural-engineer", label: "Structural engineer", rateBps: pct(10), basis: "Of the fee the engineer is paid.", requiresAuthorisedArrangement: false },
  { kind: "valuer", label: "Valuer", rateBps: pct(10), basis: "Of the fee the valuer is paid.", requiresAuthorisedArrangement: false },
  { kind: "epc-assessor", label: "EPC assessor", fixed: fromMajor(17.5), basis: "Per completed booking.", requiresAuthorisedArrangement: false },
  { kind: "photographer", label: "Photography and floor plans", rateBps: pct(12.5), basis: "Of the booking value.", requiresAuthorisedArrangement: false },
  { kind: "contractor", label: "Refurbishment contractor", rateBps: pct(6.5), basis: "Of the contract value won through the platform.", requiresAuthorisedArrangement: false },
  { kind: "removals", label: "Removals", rateBps: pct(10), basis: "Of the booking value.", requiresAuthorisedArrangement: false },
  { kind: "property-manager", label: "Property manager", rateBps: pct(8), basis: "Of the first month's management fee.", requiresAuthorisedArrangement: false },
  { kind: "letting-agent", label: "Letting agent", fixed: fromMajor(150), basis: "Per completed referral.", requiresAuthorisedArrangement: false },
  { kind: "auctioneer", label: "Auctioneer", rateBps: pct(10), basis: "Agreed revenue share.", requiresAuthorisedArrangement: false },
  { kind: "broker", label: "Mortgage or bridging broker", rateBps: pct(20), basis: "Of the broker's own fee, under an authorised introducer agreement.", requiresAuthorisedArrangement: true },
  { kind: "insurance", label: "Insurance", rateBps: pct(15), basis: "Under an authorised affiliate agreement.", requiresAuthorisedArrangement: true },
  { kind: "utilities", label: "Utilities and broadband", rateBps: pct(20), basis: "Affiliate commission.", requiresAuthorisedArrangement: false },
];

export function providerCommission(kind: ProviderKind): ProviderCommission {
  const found = PROVIDER_COMMISSIONS.find((p) => p.kind === kind);
  if (found === undefined) throw new Error(`No commission recorded for "${kind}".`);
  return found;
}

/**
 * What the platform earns from one provider engagement.
 *
 * `paidToProvider` is what the customer paid the provider. The commission is a
 * share of that, never a mark-up on top of it — a mark-up is a different
 * product and a different disclosure.
 */
export function providerFee(kind: ProviderKind, paidToProvider: Money): Money {
  const commission = providerCommission(kind);
  if (commission.fixed !== undefined) return commission.fixed;
  if (commission.rateBps !== undefined) return applyBps(paidToProvider, commission.rateBps);
  return ZERO;
}

/** The managed acquisition service, priced three ways for three kinds of buyer. */
export const MANAGED_ACQUISITION = {
  setup: fromMajor(299),
  monthlyRetainer: { from: fromMajor(499), to: fromMajor(1_500) },
  completionRateBps: { from: pct(0.25), to: pct(0.5) },
  fixedCompletionFee: { from: fromMajor(1_500), to: fromMajor(5_000) },
} as const;

export interface CreditPack {
  readonly id: string;
  readonly price: Money;
  readonly statedAs: TaxTreatmentOfPrice;
  /** Balance credited for the price paid. */
  readonly balance: Money;
  /**
   * Additional balance given as an incentive.
   *
   * Held as a separate, non-refundable lot. Refunding a bonus in cash turns a
   * discount into a withdrawal: buy the pack, take the refund, keep the
   * difference. Because it never had cash behind it, it can never come back out
   * as cash.
   */
  readonly bonus: Money;
}

export const CREDIT_PACKS: readonly CreditPack[] = [
  { id: "topup-25", price: fromMajor(25), statedAs: "inclusive", balance: fromMajor(25), bonus: ZERO },
  { id: "topup-100", price: fromMajor(100), statedAs: "inclusive", balance: fromMajor(100), bonus: fromMajor(5) },
  { id: "topup-500", price: fromMajor(500), statedAs: "inclusive", balance: fromMajor(500), bonus: fromMajor(50) },
];

export function creditPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id);
}

/**
 * How long prepaid balance lasts.
 *
 * Unexpiring prepaid balance is an open-ended liability that has to be carried
 * indefinitely and can be redeemed years later against costs that have since
 * risen. Twelve months on money that was actually paid; three on balance that
 * was given away, because a promotional incentive that never expires is not an
 * incentive to do anything now.
 *
 * Both must be stated plainly at the point of sale. An expiry a customer was
 * not told about is an unfair term and would be refunded on demand, which makes
 * it worse than no expiry at all.
 */
export const PURCHASED_CREDIT_MONTHS = 12;
export const GRANTED_CREDIT_MONTHS = 3;

/**
 * What a disputed payment costs us before anything else.
 *
 * Payment providers charge a fixed fee per dispute and keep it whichever way
 * the dispute goes. It is a real cost of a customer choosing to dispute rather
 * than ask, it is not returned by winning, and a platform that does not record
 * it cannot see what a serial disputer is worth, which is usually a large
 * negative number.
 *
 * Fifteen pounds is the common figure across UK providers. Check it against the
 * contract actually signed; it is here so there is one place to change it.
 */
export const DISPUTE_FEE: Money = fromMajor(15);

/* ------------------------------------------------------ metered operations */

/**
 * What a metered operation costs.
 *
 * These have a real marginal cost — a language model call, a data lookup — so
 * an unmetered one is a bill that grows with usage and is collected from
 * nobody. Priced here so a caller cannot decide its own price, and priced above
 * cost so that heavy use is profitable rather than merely survivable.
 */
export type MeteredOperation =
  | "ai-deal-analysis"
  | "ai-underwriting-summary"
  | "memorandum-export"
  | "bulk-data-export";

export const OPERATION_PRICES: Record<MeteredOperation, Money> = {
  "ai-deal-analysis": fromMajor(2.5),
  "ai-underwriting-summary": fromMajor(4),
  "memorandum-export": fromMajor(1.5),
  "bulk-data-export": fromMajor(15),
};

export function operationPrice(operation: MeteredOperation): Money {
  return OPERATION_PRICES[operation];
}

import type { Bps, Money } from "@shared/money";

/** ISO-3166-1 alpha-2 plus a sub-national code where property law diverges. */
export type JurisdictionCode = "GB-ENG" | "GB-SCT" | "GB-WLS" | "GB-NIR" | "US-GEN";

export type PropertyType =
  | "house"
  | "flat"
  | "bungalow"
  | "hmo"
  | "commercial"
  | "mixed-use"
  | "land";

export type Tenure = "freehold" | "leasehold" | "share-of-freehold" | "unknown";

export type OccupancyStatus =
  | "vacant"
  | "owner-occupied"
  | "tenanted"
  | "tenanted-arrears"
  | "unknown";

/**
 * The seller's reason for being in the market. This is the single most
 * predictive input in the system: it drives the Motivation Score, the routes
 * offered, and — critically — whether the Seller Protection Engine will let a
 * discounted structure be shown at all.
 */
export type SellerSituation =
  | "probate"
  | "inherited"
  | "divorce"
  | "relocation"
  | "landlord-exit"
  | "problem-tenant"
  | "vacant-property"
  | "needs-major-works"
  | "chain-collapse"
  | "failed-listing"
  | "mortgage-arrears"
  | "repossession-threat"
  | "auction-alternative"
  | "portfolio-disposal"
  | "development-exit"
  | "urgent-cash-need"
  | "downsizing";

/** What the seller is actually optimising for. Not every seller wants price. */
export type SellerPriority = "speed" | "certainty" | "price" | "convenience" | "flexibility";

export interface SellerProfile {
  readonly situation: SellerSituation;
  readonly priorities: readonly SellerPriority[];
  /** Seller's own stated deadline, in days. Undefined means no deadline given. */
  readonly targetDays?: number;
  /** Seller's own price expectation, if stated. Deliberately optional. */
  readonly priceExpectation?: Money;
  /** Free-text description of the situation, as the seller wrote it. */
  readonly narrative?: string;
  /** Answers to the vulnerability screening questions. */
  readonly screening?: SellerScreening;
}

/**
 * Screening answers feeding the Seller Protection Engine. Every field is
 * optional and absent-means-unknown; the engine treats unknown as a reason to
 * be more cautious, never less.
 */
export interface SellerScreening {
  readonly hasIndependentLegalAdvice?: boolean;
  readonly hasReceivedIndependentValuation?: boolean;
  readonly isSoleDecisionMaker?: boolean;
  readonly reportsFinancialDistress?: boolean;
  readonly reportsHealthOrCapacityConcern?: boolean;
  readonly isUnderTimePressureFromThirdParty?: boolean;
  readonly ageBand?: "under-65" | "65-79" | "80-plus" | "undisclosed";
}

export interface PropertyFacts {
  readonly id: string;
  readonly jurisdiction: JurisdictionCode;
  readonly postcodeArea: string;
  readonly locality: string;
  readonly propertyType: PropertyType;
  readonly tenure: Tenure;
  readonly bedrooms: number;
  readonly occupancy: OccupancyStatus;
  /** Independent estimate of open-market value, evidence-backed. */
  readonly openMarketValue: Money;
  /** Confidence in the OMV estimate, basis points. 10_000 = certain. */
  readonly valuationConfidence: Bps;
  /** Estimated cost of works to reach the assumed exit condition. */
  readonly refurbishmentEstimate: Money;
  /** Projected value once works complete. */
  readonly postWorksValue: Money;
  /** Achievable monthly rent post-works. */
  readonly monthlyRent: Money;
  /** Unexpired lease term in years. Freeholds carry undefined. */
  readonly leaseYearsRemaining?: number;
  readonly knownIssues: readonly PropertyIssue[];
}

export type PropertyIssue =
  | "structural"
  | "damp"
  | "subsidence"
  | "japanese-knotweed"
  | "cladding"
  | "short-lease"
  | "no-building-regs"
  | "title-defect"
  | "restrictive-covenant"
  | "flood-risk"
  | "non-standard-construction"
  | "unregistered-title";

/** A candidate acquisition structure the Deal Architect can propose. */
export type StructureKind =
  | "cash-purchase"
  | "bridging-refurb-refinance"
  | "private-money-purchase"
  | "jv-equity"
  | "deferred-consideration"
  | "seller-finance"
  | "option-agreement"
  | "lease-option"
  | "assisted-sale"
  | "auction-finance";

export interface DealInputs {
  readonly property: PropertyFacts;
  readonly seller: SellerProfile;
  /** Price being modelled. May differ from the seller's expectation. */
  readonly purchasePrice: Money;
  /** Buyer already owns other dwellings — drives the surcharge. */
  readonly buyerOwnsOtherProperty: boolean;
  readonly buyerIsCompany: boolean;
  readonly buyerIsNonResident: boolean;
  /** Whole months from exchange to exit (sale or refinance). */
  readonly holdMonths: number;
  readonly structure: StructureKind;
  readonly finance: FinanceTerms;
  readonly exit: ExitStrategy;
}

export interface FinanceTerms {
  /** Debt as a proportion of purchase price, basis points. */
  readonly ltvBps: Bps;
  /**
   * Share of the refurbishment budget the senior lender advances, basis points.
   *
   * Refurbishment bridging normally funds works in arrears tranches against
   * surveyor sign-off. Modelling the facility as purchase-only overstates the
   * equity requirement on every BRR deal and makes well-financed projects look
   * unfundable. Zero for a lender that will not fund works.
   */
  readonly refurbAdvanceBps: Bps;
  /** Annual interest rate on the senior facility, basis points. */
  readonly annualRateBps: Bps;
  /** Arrangement fee as a proportion of the facility, basis points. */
  readonly arrangementFeeBps: Bps;
  /** Exit fee as a proportion of the facility, basis points. */
  readonly exitFeeBps: Bps;
  /** True where interest is retained/rolled rather than serviced monthly. */
  readonly interestRolledUp: boolean;
  /** Lender legal and valuation costs borne by the borrower. */
  readonly lenderCosts: Money;
}

export type ExitStrategy = "sell" | "refinance-and-hold" | "rent-only" | "assign";

/** Everything the OS decided about one modelled deal. */
export interface DealAppraisal {
  readonly inputs: DealInputs;
  readonly costs: CostStack;
  readonly funding: FundingRequirement;
  readonly exit: ExitOutcome;
  /** Profit before any tax on the profit itself. */
  readonly profitBeforeTax: Money;
  readonly profitTax: Money;
  readonly profitTaxLabel: string;
  readonly profitTaxCaveats: readonly string[];
  /**
   * Profit after estimated profit tax. Every score and verdict is computed
   * from this, never from the pre-tax figure.
   */
  readonly profit: Money;
  readonly roiOnCashBps: Bps;
  readonly annualisedRoiBps: Bps;
  readonly marginOnGdvBps: Bps;
  /** Headline discount: purchase price against open market value. */
  readonly discountToOmvBps: Bps;
  /**
   * True discount: total money in, against open market value. A "20% BMV"
   * purchase that costs 19% of value to transact and repair is not a discount,
   * and this is the number that says so.
   */
  readonly trueDiscountBps: Bps;
  /** Total capital deployed including every cost. */
  readonly effectiveBasis: Money;
}

export interface CostStack {
  readonly purchasePrice: Money;
  readonly transferTax: Money;
  readonly transferTaxLabel: string;
  readonly buyerLegal: Money;
  readonly survey: Money;
  readonly financeArrangement: Money;
  readonly financeInterest: Money;
  readonly financeExit: Money;
  readonly lenderCosts: Money;
  readonly refurbishment: Money;
  readonly holdingCosts: Money;
  readonly sellingCosts: Money;
  readonly contingency: Money;
  readonly total: Money;
  /** Total excluding the purchase price itself. */
  readonly totalCostsExcludingPurchase: Money;
}

export interface FundingRequirement {
  readonly totalRequired: Money;
  readonly seniorDebt: Money;
  /** Everything the senior lender will not advance. */
  readonly equityRequired: Money;
}

export interface ExitOutcome {
  readonly strategy: ExitStrategy;
  readonly grossDevelopmentValue: Money;
  readonly netProceeds: Money;
  /** Populated for refinance exits: capital left in after refinancing. */
  readonly capitalLeftIn?: Money;
  readonly refinanceAdvance?: Money;
  readonly monthlyNetRent?: Money;
}

export type Verdict = "proceed" | "negotiate" | "restructure" | "reject";

export interface ScoreBreakdown {
  readonly composite: number;
  readonly components: readonly ScoreComponent[];
}

export interface ScoreComponent {
  readonly key: string;
  readonly label: string;
  readonly score: number;
  readonly weightBps: Bps;
  readonly rationale: string;
}

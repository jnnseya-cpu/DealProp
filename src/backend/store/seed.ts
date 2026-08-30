import { bps, fromMajor, pct } from "@shared/money";
import { STANDARD_MILESTONES, type Milestone, type MilestoneStatus } from "@shared/domain/completion";
import type { BuyBox, FundingBox } from "@shared/domain/matching";
import type { DealInputs, FinanceTerms, PropertyFacts, SellerProfile } from "@shared/domain/types";
import type { ListingSignal } from "@shared/domain/goldmine";
import { replaceAll, type DealRecord } from "./repository";

/**
 * Seed data.
 *
 * These are illustrative deals chosen to exercise the engine's edges, not a
 * showreel. One is genuinely good, one is a trap that only fails after tax and
 * stress testing, one is blocked by the Seller Protection Engine, and one is a
 * case where no cash purchase works but an assisted sale does. A seed set
 * where everything scores 90 would hide exactly the behaviour worth checking.
 */

const BRIDGING: FinanceTerms = {
  ltvBps: pct(70),
  refurbAdvanceBps: pct(100),
  annualRateBps: pct(9.6),
  arrangementFeeBps: pct(2),
  exitFeeBps: pct(1),
  interestRolledUp: true,
  lenderCosts: fromMajor(1_500),
};

function milestones(overrides: Record<string, MilestoneStatus>, notes: Record<string, string> = {}): Milestone[] {
  return STANDARD_MILESTONES.map((m) => ({
    ...m,
    status: overrides[m.key] ?? "not-started",
    ...(notes[m.key] !== undefined ? { note: notes[m.key] } : {}),
    ...(overrides[m.key] === "expiring" ? { expiresInDays: 13 } : {}),
  }));
}

// --- Deal 1: the good one --------------------------------------------------

const erdington: PropertyFacts = {
  id: "prop-erdington",
  jurisdiction: "GB-ENG",
  postcodeArea: "B23",
  locality: "Erdington",
  propertyType: "house",
  tenure: "freehold",
  bedrooms: 3,
  occupancy: "vacant",
  openMarketValue: fromMajor(212_000),
  valuationConfidence: bps(8_200),
  refurbishmentEstimate: fromMajor(34_000),
  postWorksValue: fromMajor(285_000),
  monthlyRent: fromMajor(1_250),
  knownIssues: ["damp", "no-building-regs"],
};

const erdingtonSeller: SellerProfile = {
  situation: "probate",
  priorities: ["speed", "certainty", "convenience"],
  targetDays: 35,
  priceExpectation: fromMajor(178_000),
  narrative:
    "My father passed away last year and the house has sat empty since. It needs a lot of work and none of us live locally. We want it dealt with.",
  screening: {
    hasIndependentLegalAdvice: true,
    hasReceivedIndependentValuation: true,
    isSoleDecisionMaker: false,
    reportsFinancialDistress: false,
    ageBand: "under-65",
  },
};

// --- Deal 2: looks good, fails after tax and stress -------------------------

const sellyOak: PropertyFacts = {
  id: "prop-selly-oak",
  jurisdiction: "GB-ENG",
  postcodeArea: "B29",
  locality: "Selly Oak",
  propertyType: "flat",
  tenure: "leasehold",
  bedrooms: 2,
  occupancy: "tenanted",
  openMarketValue: fromMajor(168_000),
  valuationConfidence: bps(7_000),
  refurbishmentEstimate: fromMajor(21_000),
  postWorksValue: fromMajor(196_000),
  monthlyRent: fromMajor(950),
  leaseYearsRemaining: 74,
  knownIssues: ["short-lease", "cladding"],
};

const sellyOakSeller: SellerProfile = {
  situation: "landlord-exit",
  priorities: ["convenience", "certainty"],
  targetDays: 90,
  priceExpectation: fromMajor(152_000),
  narrative: "I'm winding down my portfolio. This one has a shortening lease and I'd rather not deal with it.",
  screening: {
    hasIndependentLegalAdvice: true,
    hasReceivedIndependentValuation: true,
    isSoleDecisionMaker: true,
    ageBand: "under-65",
  },
};

// --- Deal 3: blocked by the protection engine ------------------------------

const handsworth: PropertyFacts = {
  id: "prop-handsworth",
  jurisdiction: "GB-ENG",
  postcodeArea: "B21",
  locality: "Handsworth",
  propertyType: "house",
  tenure: "freehold",
  bedrooms: 4,
  occupancy: "owner-occupied",
  openMarketValue: fromMajor(245_000),
  valuationConfidence: bps(7_800),
  refurbishmentEstimate: fromMajor(18_000),
  postWorksValue: fromMajor(285_000),
  monthlyRent: fromMajor(1_400),
  knownIssues: [],
};

const handsworthSeller: SellerProfile = {
  situation: "repossession-threat",
  priorities: ["speed"],
  targetDays: 14,
  priceExpectation: fromMajor(150_000),
  narrative: "The lender has started proceedings. I need this gone in two weeks. My nephew is handling it for me.",
  screening: {
    hasIndependentLegalAdvice: false,
    hasReceivedIndependentValuation: false,
    isSoleDecisionMaker: true,
    reportsFinancialDistress: true,
    isUnderTimePressureFromThirdParty: true,
    ageBand: "80-plus",
  },
};

// --- Deal 4: no cash purchase works, but an assisted sale might -------------

const harborne: PropertyFacts = {
  id: "prop-harborne",
  jurisdiction: "GB-ENG",
  postcodeArea: "B17",
  locality: "Harborne",
  propertyType: "house",
  tenure: "freehold",
  bedrooms: 3,
  occupancy: "owner-occupied",
  openMarketValue: fromMajor(268_000),
  valuationConfidence: bps(8_600),
  refurbishmentEstimate: fromMajor(26_000),
  postWorksValue: fromMajor(325_000),
  monthlyRent: fromMajor(1_450),
  knownIssues: [],
};

const harborneSeller: SellerProfile = {
  situation: "failed-listing",
  priorities: ["price", "flexibility"],
  targetDays: 150,
  priceExpectation: fromMajor(262_000),
  narrative:
    "It's been on the market nearly a year. Two agents. I know it's dated but I'm not giving it away — I need £260,000 to buy where I'm going.",
  screening: {
    hasIndependentLegalAdvice: true,
    hasReceivedIndependentValuation: true,
    isSoleDecisionMaker: true,
    ageBand: "under-65",
  },
};

// --- Listing signals for GoldMine -----------------------------------------

const harborneListing: ListingSignal = {
  propertyId: "prop-harborne",
  daysOnMarket: 327,
  initialAskingPrice: fromMajor(315_000),
  currentAskingPrice: fromMajor(279_000),
  priceReductions: 4,
  relistCount: 1,
  agentCount: 2,
  previouslyFailedSale: true,
  appearsVacant: false,
  photoCount: 6,
  hasFloorplan: false,
  epcRating: "E",
  localMedianDaysOnMarket: 71,
  localMedianAsking: fromMajor(268_000),
};

const sellyOakListing: ListingSignal = {
  propertyId: "prop-selly-oak",
  daysOnMarket: 198,
  initialAskingPrice: fromMajor(180_000),
  currentAskingPrice: fromMajor(172_000),
  priceReductions: 2,
  relistCount: 0,
  agentCount: 1,
  previouslyFailedSale: false,
  appearsVacant: false,
  photoCount: 14,
  hasFloorplan: true,
  epcRating: "D",
  localMedianDaysOnMarket: 64,
  localMedianAsking: fromMajor(175_000),
};

const erdingtonListing: ListingSignal = {
  propertyId: "prop-erdington",
  daysOnMarket: 412,
  initialAskingPrice: fromMajor(240_000),
  currentAskingPrice: fromMajor(199_950),
  priceReductions: 3,
  relistCount: 2,
  agentCount: 3,
  previouslyFailedSale: true,
  appearsVacant: true,
  photoCount: 5,
  hasFloorplan: false,
  epcRating: "F",
  localMedianDaysOnMarket: 82,
  localMedianAsking: fromMajor(205_000),
};

function deal(
  id: string,
  reference: string,
  property: PropertyFacts,
  seller: SellerProfile,
  purchasePrice: DealInputs["purchasePrice"],
  extras: Partial<DealInputs> = {},
): DealInputs {
  return {
    property,
    seller,
    purchasePrice,
    buyerOwnsOtherProperty: true,
    buyerIsCompany: true,
    buyerIsNonResident: false,
    holdMonths: 9,
    structure: "bridging-refurb-refinance",
    finance: BRIDGING,
    exit: "refinance-and-hold",
    ...extras,
  };
}

const DEALS: DealRecord[] = [
  {
    id: "deal-0001",
    reference: "LODE-0001",
    createdAt: "2026-06-02T09:14:00.000Z",
    property: erdington,
    seller: erdingtonSeller,
    // Priced below the family's £178,000 expectation: the Director returns
    // "negotiate" here rather than "proceed", which is the honest read on a
    // deal whose margin depends on the entry price.
    inputs: deal("deal-0001", "LODE-0001", erdington, erdingtonSeller, fromMajor(172_000)),
    listing: erdingtonListing,
    borrowerCompletedDeals: 6,
    status: "in-market",
    milestones: milestones({
      "seller-id": "complete",
      "buyer-id": "complete",
      "source-of-funds": "complete",
      "terms-agreed": "complete",
      "protection-cleared": "complete",
      "jv-agreement": "in-progress",
      "tax-review": "complete",
      valuation: "expiring",
      survey: "complete",
      "lender-application": "complete",
      "lender-offer": "blocked",
      "contract-draft": "complete",
      searches: "in-progress",
      enquiries: "in-progress",
    }, {
      "lender-offer": "lender requires the signed JV agreement before issuing a formal offer",
    }),
  },
  {
    id: "deal-0002",
    reference: "LODE-0002",
    createdAt: "2026-06-14T15:02:00.000Z",
    property: sellyOak,
    seller: sellyOakSeller,
    inputs: deal("deal-0002", "LODE-0002", sellyOak, sellyOakSeller, fromMajor(150_000)),
    listing: sellyOakListing,
    borrowerCompletedDeals: 2,
    status: "qualified",
    milestones: milestones({
      "seller-id": "complete",
      "buyer-id": "complete",
      "terms-agreed": "in-progress",
      "protection-cleared": "complete",
    }),
  },
  {
    id: "deal-0003",
    reference: "LODE-0003",
    createdAt: "2026-07-01T11:30:00.000Z",
    property: handsworth,
    seller: handsworthSeller,
    inputs: deal("deal-0003", "LODE-0003", handsworth, handsworthSeller, fromMajor(150_000), {
      holdMonths: 6,
      structure: "cash-purchase",
      exit: "sell",
    }),
    borrowerCompletedDeals: 11,
    status: "new",
    milestones: milestones({
      "seller-id": "complete",
      "protection-cleared": "blocked",
    }, {
      "protection-cleared": "elderly seller, third-party pressure reported, no independent advice evidenced",
    }),
  },
  {
    id: "deal-0004",
    reference: "LODE-0004",
    createdAt: "2026-07-19T08:45:00.000Z",
    property: harborne,
    seller: harborneSeller,
    inputs: deal("deal-0004", "LODE-0004", harborne, harborneSeller, fromMajor(232_000), {
      holdMonths: 7,
      structure: "cash-purchase",
      exit: "sell",
    }),
    listing: harborneListing,
    borrowerCompletedDeals: 4,
    status: "new",
    milestones: milestones({ "seller-id": "complete" }),
  },
];

const BUY_BOXES: BuyBox[] = [
  {
    id: "bb-001",
    investorName: "Ravenscroft Property Partners",
    jurisdictions: ["GB-ENG"],
    localities: ["Erdington", "Handsworth", "Selly Oak"],
    propertyTypes: ["house", "bungalow"],
    minPrice: fromMajor(100_000),
    maxPrice: fromMajor(280_000),
    minBedrooms: 3,
    minMarginBps: pct(12),
    maxRefurbishment: fromMajor(60_000),
    acceptsRefurbishment: true,
    minYieldBps: pct(7),
    maxCompletionDays: 28,
    acceptableStructures: ["bridging-refurb-refinance", "cash-purchase", "private-money-purchase"],
    minDealScore: 60,
    active: true,
  },
  {
    id: "bb-002",
    investorName: "Calder & Wray",
    jurisdictions: ["GB-ENG", "GB-SCT"],
    localities: [],
    propertyTypes: ["house", "flat"],
    minPrice: fromMajor(120_000),
    maxPrice: fromMajor(350_000),
    minBedrooms: 2,
    minMarginBps: pct(18),
    maxRefurbishment: fromMajor(40_000),
    acceptsRefurbishment: true,
    minYieldBps: pct(6),
    maxCompletionDays: 45,
    acceptableStructures: ["bridging-refurb-refinance", "cash-purchase", "jv-equity"],
    minDealScore: 70,
    active: true,
  },
  {
    id: "bb-003",
    investorName: "Thomasin Holdings",
    jurisdictions: ["GB-ENG"],
    localities: ["Harborne", "Selly Oak"],
    propertyTypes: ["house"],
    minPrice: fromMajor(180_000),
    maxPrice: fromMajor(400_000),
    minBedrooms: 3,
    minMarginBps: pct(8),
    maxRefurbishment: fromMajor(80_000),
    acceptsRefurbishment: true,
    minYieldBps: pct(5),
    maxCompletionDays: 21,
    acceptableStructures: ["cash-purchase", "assisted-sale", "deferred-consideration"],
    minDealScore: 55,
    active: true,
  },
];

const FUNDING_BOXES: FundingBox[] = [
  {
    id: "fb-001",
    funderName: "Marchmont Bridging",
    kind: "bridging-lender",
    jurisdictions: ["GB-ENG", "GB-SCT"],
    localities: [],
    capitalAvailable: fromMajor(4_000_000),
    minTicket: fromMajor(75_000),
    maxTicket: fromMajor(500_000),
    propertyTypes: ["house", "flat", "bungalow", "hmo"],
    maxLtvBps: pct(70),
    minTermMonths: 3,
    maxTermMonths: 18,
    acceptsRefurbishment: true,
    acceptsDevelopment: false,
    requiresFirstCharge: true,
    minBorrowerCompletedDeals: 2,
    requiredReturnBps: pct(9),
    personalGuaranteeRequired: true,
    active: true,
  },
  {
    id: "fb-002",
    funderName: "Ardleigh Family Office",
    kind: "family-office",
    jurisdictions: ["GB-ENG"],
    localities: ["Erdington", "Harborne"],
    capitalAvailable: fromMajor(2_000_000),
    minTicket: fromMajor(100_000),
    maxTicket: fromMajor(400_000),
    propertyTypes: ["house", "bungalow"],
    maxLtvBps: pct(65),
    minTermMonths: 6,
    maxTermMonths: 24,
    acceptsRefurbishment: true,
    acceptsDevelopment: false,
    requiresFirstCharge: true,
    minBorrowerCompletedDeals: 5,
    requiredReturnBps: pct(8),
    personalGuaranteeRequired: false,
    active: true,
  },
  {
    id: "fb-003",
    funderName: "Pennine Deal Equity",
    kind: "jv-equity-partner",
    jurisdictions: ["GB-ENG"],
    localities: [],
    capitalAvailable: fromMajor(1_200_000),
    minTicket: fromMajor(50_000),
    maxTicket: fromMajor(250_000),
    propertyTypes: ["house", "flat", "hmo", "commercial"],
    maxLtvBps: pct(80),
    minTermMonths: 6,
    maxTermMonths: 36,
    acceptsRefurbishment: true,
    acceptsDevelopment: true,
    requiresFirstCharge: false,
    minBorrowerCompletedDeals: 1,
    requiredReturnBps: pct(12),
    personalGuaranteeRequired: false,
    active: true,
  },
];

export async function seed(): Promise<void> {
  // Subscribers are deliberately absent: nobody may be enrolled without their
  // own recorded consent, so there is no such thing as a seeded subscriber.
  await replaceAll({ deals: DEALS, buyBoxes: BUY_BOXES, fundingBoxes: FUNDING_BOXES, subscribers: [], accounts: [], auditEvents: [], blogViews: [], subscriptions: [], creditLots: [], ledgerEntries: [], billingEvents: [], discoveryCandidates: [], outreachMessages: [], suppressions: [] });
}

export const SEED_DEALS = DEALS;
export const SEED_BUY_BOXES = BUY_BOXES;
export const SEED_FUNDING_BOXES = FUNDING_BOXES;

if (process.argv[1]?.includes("seed")) {
  seed()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log(`Seeded ${DEALS.length} deals, ${BUY_BOXES.length} buy boxes, ${FUNDING_BOXES.length} funding boxes.`);
    })
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error(error);
      process.exit(1);
    });
}

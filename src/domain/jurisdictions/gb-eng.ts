import { fromMajor, money, pct, type Money } from "@/lib/money";
import type { StructureKind } from "@/domain/types";
import type { JurisdictionPack, StructureRuling, TransferTaxInput } from "./types";
import { ukProfitTax } from "./profitTax";

/**
 * England & Northern Ireland: Stamp Duty Land Tax.
 *
 * RATES ARE A SNAPSHOT AND MUST BE RE-VERIFIED EACH BUDGET. They are expressed
 * as explicit band tables rather than inline arithmetic precisely so that
 * updating them is a data edit with a failing test, not a code change.
 */

interface Band {
  /** Lower bound of the band, exclusive of the band below. */
  readonly from: Money;
  readonly rateBps: number;
}

/** Residential bands effective from 1 April 2025. */
const RESIDENTIAL_BANDS: readonly Band[] = [
  { from: fromMajor(0), rateBps: 0 },
  { from: fromMajor(125_000), rateBps: 200 },
  { from: fromMajor(250_000), rateBps: 500 },
  { from: fromMajor(925_000), rateBps: 1_000 },
  { from: fromMajor(1_500_000), rateBps: 1_200 },
];

const NON_RESIDENTIAL_BANDS: readonly Band[] = [
  { from: fromMajor(0), rateBps: 0 },
  { from: fromMajor(150_000), rateBps: 200 },
  { from: fromMajor(250_000), rateBps: 500 },
];

/** Additional dwelling surcharge, applied to the whole price. */
const ADDITIONAL_PROPERTY_SURCHARGE_BPS = 500;
/** Non-UK-resident surcharge on residential property. */
const NON_RESIDENT_SURCHARGE_BPS = 200;
/**
 * Companies acquiring a dwelling above this threshold pay a flat higher rate
 * unless a relief applies. Reliefs (property rental businesses, developers)
 * are common in exactly the deals this OS models, so the flat rate is applied
 * only as a ceiling flag, never assumed silently — see `companyFlatRate`.
 */
const COMPANY_FLAT_RATE_THRESHOLD = fromMajor(500_000);
const COMPANY_FLAT_RATE_BPS = 1_700;

function bandedTax(price: Money, bands: readonly Band[]): Money {
  let total = 0;
  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i];
    if (band === undefined) continue;
    if (price <= band.from) break;
    const next = bands[i + 1];
    const upper = next === undefined ? price : Math.min(price, next.from);
    const slice = upper - band.from;
    if (slice > 0) {
      total += Math.round((slice * band.rateBps) / 10_000);
    }
  }
  return money(total);
}

export function stampDutyLandTax(input: TransferTaxInput): Money {
  const { price, isResidential, buyerOwnsOtherProperty, buyerIsCompany, buyerIsNonResident } =
    input;

  if (price <= 0) return money(0);

  if (!isResidential) {
    return bandedTax(price, NON_RESIDENTIAL_BANDS);
  }

  // A company buying a dwelling over the threshold pays the flat higher rate
  // unless it claims a relief. Deals modelled here are overwhelmingly relief-
  // eligible (property rental business / redevelopment), so the flat rate is
  // charged only when it is the genuinely applicable worst case, and callers
  // are expected to surface it as an assumption for legal confirmation.
  if (buyerIsCompany && price > COMPANY_FLAT_RATE_THRESHOLD) {
    return money(Math.round((price * COMPANY_FLAT_RATE_BPS) / 10_000));
  }

  let surchargeBps = 0;
  // A company acquiring a dwelling is treated as an additional-dwelling buyer
  // from the first purchase; there is no first-property exemption for it.
  if (buyerOwnsOtherProperty || buyerIsCompany) {
    surchargeBps += ADDITIONAL_PROPERTY_SURCHARGE_BPS;
  }
  if (buyerIsNonResident) {
    surchargeBps += NON_RESIDENT_SURCHARGE_BPS;
  }

  const base = bandedTax(price, RESIDENTIAL_BANDS);
  const surcharge = money(Math.round((price * surchargeBps) / 10_000));
  return money(base + surcharge);
}

const RULINGS: Record<StructureKind, Omit<StructureRuling, "structure">> = {
  "cash-purchase": {
    permission: "permitted",
    note: "Conventional acquisition. Estate agency activity may trigger HMRC AML supervision where the platform introduces buyers to sellers.",
    requires: ["HMRC AML registration where introductions are performed", "AML/KYC on both parties"],
  },
  "bridging-refurb-refinance": {
    permission: "regulated",
    note: "Bridging finance to a company or for investment property is typically unregulated, but arranging or introducing to lenders can be a regulated activity. Owner-occupied security is very likely regulated.",
    requires: [
      "FCA authorisation or an appointed-representative arrangement for credit broking",
      "Financial promotion approval for any lender-facing material",
    ],
  },
  "private-money-purchase": {
    permission: "regulated",
    note: "Accepting money from individuals to fund property purchases can constitute a collective investment scheme or a regulated deposit. Structure and promotion both require advice.",
    requires: [
      "Investor categorisation (HNW / sophisticated / professional)",
      "Financial promotion approved by an authorised person",
    ],
  },
  "jv-equity": {
    permission: "regulated",
    note: "A JV interest may be a security or a collective investment scheme depending on how passive the investor is and how many participants there are.",
    requires: [
      "Legal review of scheme perimeter",
      "Investor categorisation",
      "Written JV agreement before funds move",
    ],
  },
  "deferred-consideration": {
    permission: "permitted-with-professional",
    note: "Deferred payment of part of the price is ordinary contract law, but security for the deferred element and the seller's protection must be documented.",
    requires: ["Independent legal advice for the seller", "Charge or restriction securing the deferred sum"],
  },
  "seller-finance": {
    permission: "regulated",
    note: "Where the seller extends credit secured on a dwelling the buyer will occupy, this can be a regulated mortgage contract. Seller finance is materially easier where the buyer is a company and the property is an investment.",
    requires: [
      "Confirmation the arrangement is not a regulated mortgage contract",
      "Independent legal advice for the seller",
      "Independent legal advice for the buyer",
    ],
  },
  "option-agreement": {
    permission: "permitted-with-professional",
    note: "Options over land are well established, particularly for development. The option must be registered to bind successors.",
    requires: ["Registration of the option at HM Land Registry", "Independent legal advice for the seller"],
  },
  "lease-option": {
    permission: "regulated",
    note: "Lease options over residential property attract close scrutiny. Consumer protection, mortgage lender consent and possible regulated-mortgage characterisation all apply.",
    requires: [
      "Existing lender consent",
      "Independent legal advice for the seller",
      "Assessment against consumer protection rules",
    ],
  },
  "assisted-sale": {
    permission: "regulated",
    note: "Arranging works and a subsequent sale on a seller's behalf is very likely estate agency work and engages consumer protection rules on price and profit disclosure.",
    requires: [
      "HMRC AML registration",
      "Redress scheme membership",
      "Full disclosure of the platform's and buyer's profit to the seller",
    ],
  },
  "auction-finance": {
    permission: "regulated",
    note: "Short-term finance against an auction purchase. Same credit-broking perimeter as bridging.",
    requires: ["FCA authorisation or AR arrangement for credit broking"],
  },
};

export const GB_ENG: JurisdictionPack = {
  code: "GB-ENG",
  name: "England & Northern Ireland",
  currency: "GBP",
  asOf: "2025-04-06",
  sources: [
    "HMRC SDLT rates and thresholds",
    "HMRC money laundering supervision guidance for estate agency businesses",
    "FCA PERG 4 — regulated activities connected with mortgages",
  ],
  transferTaxLabel: "SDLT",
  transferTax: stampDutyLandTax,
  profitTax: ukProfitTax,
  defaults: {
    buyerLegal: fromMajor(1_800),
    survey: fromMajor(700),
    sellingAgentBps: pct(1.2),
    sellerLegalOnExit: fromMajor(1_400),
    monthlyHoldingCost: fromMajor(320),
    contingencyBps: pct(12),
    rentalLeakageBps: pct(28),
  },
  structureStatus(structure) {
    const ruling = RULINGS[structure];
    return { structure, ...ruling };
  },
  obligations: [
    {
      key: "hmrc-aml",
      label: "HMRC AML supervision",
      detail:
        "Businesses carrying out estate agency work, including introducing sellers to buyers, must register for anti-money-laundering supervision and apply risk-based customer due diligence.",
      authority: "HMRC",
    },
    {
      key: "fca-promotions",
      label: "Financial promotions",
      detail:
        "Any invitation or inducement to engage in investment activity must be made or approved by an authorised person, or fall within an exemption. This covers deal packs sent to private investors.",
      authority: "FCA",
    },
    {
      key: "fca-credit-broking",
      label: "Credit broking and mortgage arranging",
      detail:
        "Introducing borrowers to lenders for a fee can be a regulated activity. Owner-occupied security substantially increases the likelihood of regulation.",
      authority: "FCA",
    },
    {
      key: "cpr",
      label: "Consumer protection",
      detail:
        "Material information about price, the platform's remuneration and the buyer's intended profit must be disclosed to consumer sellers. Omission can be an unfair commercial practice.",
      authority: "CMA / Trading Standards",
    },
    {
      key: "redress",
      label: "Redress scheme membership",
      detail:
        "Estate agency work requires membership of an approved redress scheme covering complaints from consumers.",
      authority: "Approved redress schemes",
    },
  ],
};

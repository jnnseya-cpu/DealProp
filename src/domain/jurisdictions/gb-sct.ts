import { fromMajor, money, pct, type Money } from "@/lib/money";
import type { StructureKind } from "@/domain/types";
import type { JurisdictionPack, StructureRuling, TransferTaxInput } from "./types";
import { ukProfitTax } from "./profitTax";

/**
 * Scotland: Land and Buildings Transaction Tax, plus the Additional Dwelling
 * Supplement. Scotland exists in this repository to prove the abstraction —
 * different tax, different bands, different conveyancing vocabulary, same
 * engine. If the pack interface only fitted England it would be a fiction.
 *
 * RATES ARE A SNAPSHOT AND MUST BE RE-VERIFIED. Revenue Scotland sets these
 * independently of the UK Budget.
 */

interface Band {
  readonly from: Money;
  readonly rateBps: number;
}

const RESIDENTIAL_BANDS: readonly Band[] = [
  { from: fromMajor(0), rateBps: 0 },
  { from: fromMajor(145_000), rateBps: 200 },
  { from: fromMajor(250_000), rateBps: 500 },
  { from: fromMajor(325_000), rateBps: 1_000 },
  { from: fromMajor(750_000), rateBps: 1_200 },
];

const NON_RESIDENTIAL_BANDS: readonly Band[] = [
  { from: fromMajor(0), rateBps: 0 },
  { from: fromMajor(150_000), rateBps: 100 },
  { from: fromMajor(250_000), rateBps: 500 },
];

/** Additional Dwelling Supplement, charged on the whole consideration. */
const ADS_BPS = 800;

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

export function landAndBuildingsTransactionTax(input: TransferTaxInput): Money {
  const { price, isResidential, buyerOwnsOtherProperty, buyerIsCompany } = input;
  if (price <= 0) return money(0);

  if (!isResidential) {
    return bandedTax(price, NON_RESIDENTIAL_BANDS);
  }

  const base = bandedTax(price, RESIDENTIAL_BANDS);
  // Scotland has no non-resident surcharge; a company acquiring a dwelling
  // pays ADS from the first purchase.
  const adsApplies = buyerOwnsOtherProperty || buyerIsCompany;
  const ads = adsApplies ? money(Math.round((price * ADS_BPS) / 10_000)) : money(0);
  return money(base + ads);
}

const RULINGS: Record<StructureKind, Omit<StructureRuling, "structure">> = {
  "cash-purchase": {
    permission: "permitted",
    note: "Scottish conveyancing uses missives and disposition rather than exchange and completion; the contract binds earlier than in England.",
    requires: ["HMRC AML registration where introductions are performed", "Scottish solicitor instructed"],
  },
  "bridging-refurb-refinance": {
    permission: "regulated",
    note: "Same FCA credit-broking perimeter as the rest of the UK. Security is a standard security, not a legal charge.",
    requires: ["FCA authorisation or AR arrangement for credit broking"],
  },
  "private-money-purchase": {
    permission: "regulated",
    note: "Financial promotion and collective investment scheme rules are UK-wide and apply unchanged.",
    requires: ["Investor categorisation", "Approved financial promotion"],
  },
  "jv-equity": {
    permission: "regulated",
    note: "UK-wide scheme perimeter applies. Scottish partnership law differs from English partnership law and affects the vehicle choice.",
    requires: ["Legal review of scheme perimeter", "Scottish law advice on the JV vehicle"],
  },
  "deferred-consideration": {
    permission: "permitted-with-professional",
    note: "Deferred consideration is workable but must be secured by standard security to bind third parties.",
    requires: ["Independent legal advice for the seller", "Standard security over the deferred sum"],
  },
  "seller-finance": {
    permission: "regulated",
    note: "Regulated mortgage contract analysis is UK-wide. Security takes the form of a standard security.",
    requires: [
      "Confirmation the arrangement is not a regulated mortgage contract",
      "Independent legal advice for both parties",
    ],
  },
  "option-agreement": {
    permission: "permitted-with-professional",
    note: "Options over Scottish land must be registered in the Land Register to be effective against successors.",
    requires: ["Registration in the Land Register of Scotland"],
  },
  "lease-option": {
    permission: "not-supported",
    note: "Residential lease options sit awkwardly with Scottish residential tenancy law, which sharply restricts the landlord's ability to recover possession. Not offered pending specialist advice.",
    requires: [],
  },
  "assisted-sale": {
    permission: "regulated",
    note: "Estate agency and consumer protection obligations apply as elsewhere in the UK.",
    requires: ["HMRC AML registration", "Redress scheme membership", "Full profit disclosure to the seller"],
  },
  "auction-finance": {
    permission: "regulated",
    note: "Scottish auction practice differs; missives may conclude on the fall of the hammer with a shorter settlement window.",
    requires: ["FCA authorisation or AR arrangement for credit broking"],
  },
};

export const GB_SCT: JurisdictionPack = {
  code: "GB-SCT",
  name: "Scotland",
  currency: "GBP",
  asOf: "2025-04-06",
  sources: [
    "Revenue Scotland LBTT rates and bands",
    "Revenue Scotland Additional Dwelling Supplement guidance",
    "FCA PERG 4 — regulated activities connected with mortgages",
  ],
  transferTaxLabel: "LBTT",
  transferTax: landAndBuildingsTransactionTax,
  // Income, corporation and capital gains tax are reserved to the UK
  // government, so Scotland shares the England estimator for profit tax even
  // though its transfer tax differs. Scottish income tax rates diverge for
  // non-savings income of Scottish taxpayers and are not modelled.
  profitTax: ukProfitTax,
  defaults: {
    buyerLegal: fromMajor(1_600),
    survey: fromMajor(650),
    sellingAgentBps: pct(1.1),
    sellerLegalOnExit: fromMajor(1_300),
    monthlyHoldingCost: fromMajor(300),
    contingencyBps: pct(12),
    rentalLeakageBps: pct(28),
  },
  structureStatus(structure) {
    return { structure, ...RULINGS[structure] };
  },
  obligations: [
    {
      key: "hmrc-aml",
      label: "HMRC AML supervision",
      detail: "UK-wide estate agency AML supervision applies to introductions between sellers and buyers.",
      authority: "HMRC",
    },
    {
      key: "fca-promotions",
      label: "Financial promotions",
      detail: "UK-wide financial promotion restriction applies to deal packs sent to private investors.",
      authority: "FCA",
    },
    {
      key: "scot-conveyancing",
      label: "Missives bind early",
      detail:
        "Concluded missives create a binding contract earlier than English exchange. Withdrawal exposes the buyer to damages, so funding certainty must be established before missives conclude.",
      authority: "Law Society of Scotland",
    },
  ],
};

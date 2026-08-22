import { fromMajor, money, pct } from "@shared/money";
import type { StructureKind } from "@shared/domain/types";
import type { JurisdictionPack, StructureRuling, TransferTaxInput } from "./types";
import { usPlaceholderProfitTax } from "./profitTax";

/**
 * United States — generic placeholder pack.
 *
 * This pack deliberately does NOT model any real state. Transfer taxes,
 * licensing, and seller-finance rules vary by state and often by county, and a
 * plausible-looking wrong number is more dangerous than an obvious placeholder.
 * It exists to hold the shape of the interface for a second currency and a
 * genuinely different regulatory posture, and every structure that carries
 * federal exposure is marked accordingly.
 *
 * Do not enable this pack for live deals until a real state pack replaces it.
 */

const PLACEHOLDER_TRANSFER_TAX_BPS = 100;

const RULINGS: Record<StructureKind, Omit<StructureRuling, "structure">> = {
  "cash-purchase": {
    permission: "permitted-with-professional",
    note: "Real estate brokerage licensing is state-by-state. Marketing another person's property for compensation without a licence is an offence in most states.",
    requires: ["State brokerage licence analysis", "Title company or closing attorney engaged"],
  },
  "bridging-refurb-refinance": {
    permission: "regulated",
    note: "Hard-money lending to an entity for a business purpose is generally outside consumer mortgage rules, but broker licensing applies in many states.",
    requires: ["State lending/broker licence analysis", "Business-purpose certification"],
  },
  "private-money-purchase": {
    permission: "regulated",
    note: "Raising money from passive investors implicates federal and state securities law. A note or profit share is very likely a security.",
    requires: [
      "Securities counsel — Regulation D or another exemption",
      "Accredited investor verification",
      "Form D filing where applicable",
    ],
  },
  "jv-equity": {
    permission: "regulated",
    note: "A passive equity interest is generally a security. Genuine joint control by all members is the distinguishing factor and is fact-specific.",
    requires: ["Securities counsel", "Operating agreement executed before funds move"],
  },
  "deferred-consideration": {
    permission: "permitted-with-professional",
    note: "Ordinary contract law, but the deferred element should be secured and recorded.",
    requires: ["Closing attorney or title company", "Recorded lien securing the deferred sum"],
  },
  "seller-finance": {
    permission: "regulated",
    note: "Seller financing of a residential dwelling can make the seller a loan originator under federal rules, with limited exclusions turning on the number of properties financed per year and the loan's terms. State licensing may apply separately.",
    requires: [
      "Analysis against the federal loan originator exclusions",
      "Ability-to-repay assessment where the exclusion does not apply",
      "Licensed loan originator or attorney to prepare documents",
    ],
  },
  "option-agreement": {
    permission: "permitted-with-professional",
    note: "Options are widely used, but assigning an equitable interest for a fee is regulated as wholesaling in a growing number of states and requires a licence in some.",
    requires: ["State wholesaling rules analysis", "Recorded memorandum of option"],
  },
  "lease-option": {
    permission: "regulated",
    note: "Lease-options over residential property are recharacterised as disguised sales or as land contracts in several states, triggering foreclosure protections for the occupant.",
    requires: ["State-specific recharacterisation analysis", "Counsel-drafted documents"],
  },
  "assisted-sale": {
    permission: "not-supported",
    note: "Not offered under the generic pack. Arranging works and a subsequent sale for a consumer seller engages brokerage licensing and state consumer protection statutes that cannot be generalised.",
    requires: [],
  },
  "auction-finance": {
    permission: "regulated",
    note: "Foreclosure and tax-sale auction practice is state-specific, with redemption rights that can survive the sale.",
    requires: ["State auction and redemption rules analysis"],
  },
};

export const US_GEN: JurisdictionPack = {
  code: "US-GEN",
  name: "United States (generic placeholder)",
  currency: "USD",
  asOf: "2025-01-01",
  sources: [
    "CFPB Regulation Z §1026.36 — loan originator rules and seller-financing exclusions",
    "SEC Regulation D — private placement exemptions",
  ],
  transferTaxLabel: "Transfer tax (placeholder)",
  transferTax(input: TransferTaxInput) {
    if (input.price <= 0) return money(0);
    return money(Math.round((input.price * PLACEHOLDER_TRANSFER_TAX_BPS) / 10_000));
  },
  profitTax: usPlaceholderProfitTax,
  defaults: {
    buyerLegal: fromMajor(2_500),
    survey: fromMajor(600),
    sellingAgentBps: pct(5.5),
    sellerLegalOnExit: fromMajor(1_500),
    monthlyHoldingCost: fromMajor(450),
    contingencyBps: pct(15),
    rentalLeakageBps: pct(32),
  },
  structureStatus(structure) {
    return { structure, ...RULINGS[structure] };
  },
  obligations: [
    {
      key: "placeholder",
      label: "Placeholder pack — not deal-ready",
      detail:
        "Transfer tax and closing costs in this pack are illustrative and match no real state. Replace with a state-specific pack before using this jurisdiction for live deals.",
      authority: "Internal",
    },
    {
      key: "securities",
      label: "Federal and state securities law",
      detail:
        "Raising capital from passive investors is a securities offering unless an exemption applies. Exemptions constrain who may be approached and how the deal may be advertised.",
      authority: "SEC and state regulators",
    },
    {
      key: "loan-originator",
      label: "Loan originator rules",
      detail:
        "Seller financing secured on a residential dwelling can make the seller a loan originator, with ability-to-repay obligations, unless a narrow exclusion applies.",
      authority: "CFPB",
    },
  ],
};

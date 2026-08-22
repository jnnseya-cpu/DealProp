import type { Bps, Money } from "@/lib/money";
import type { JurisdictionCode, StructureKind } from "@/domain/types";

/**
 * A jurisdiction pack is the only place where country-specific law is encoded.
 * Domain logic elsewhere must not hardcode SDLT, "solicitor", or any other
 * England-shaped assumption: it asks the pack.
 *
 * Every rate in a pack is a snapshot with an `asOf` date and a citation. These
 * change with each Budget and are the single most likely thing in this
 * repository to be silently out of date, so they are stated, dated and tested
 * rather than buried in a formula.
 */
export interface JurisdictionPack {
  readonly code: JurisdictionCode;
  readonly name: string;
  readonly currency: "GBP" | "USD";
  /** Date the encoded rates and rules were last verified. ISO-8601. */
  readonly asOf: string;
  readonly sources: readonly string[];

  /** Name of the transfer tax, e.g. "SDLT", "LBTT", "Transfer Tax". */
  readonly transferTaxLabel: string;
  transferTax(input: TransferTaxInput): Money;

  /**
   * Tax on the profit the deal makes, charged on exit.
   *
   * A deal appraised before profit tax is not a deal appraisal, it is a
   * brochure. Corporation tax, capital gains tax and income tax on rent all
   * change which deals are worth doing, so the Deal Score is computed from
   * the after-tax figure this returns.
   */
  profitTax(input: ProfitTaxInput): ProfitTaxAssessment;

  /** Typical transaction costs, used where the deal does not state its own. */
  readonly defaults: JurisdictionDefaults;

  /** Whether a structure may be offered here, and under what conditions. */
  structureStatus(structure: StructureKind): StructureRuling;

  /** Compliance obligations triggered by operating this deal here. */
  readonly obligations: readonly RegulatoryObligation[];

  /**
   * The minimum energy rating a property must reach before it may lawfully be
   * let, where such a standard exists.
   *
   * This is the strongest landlord-exit signal in the open data: a rating below
   * the standard means the owner must spend money or stop letting, and that is
   * a decision with a deadline attached. It lives on the pack because it is
   * country-specific law — England and Wales enforce it through MEES, Scotland
   * abandoned its equivalent, and nothing outside `jurisdictions/` may assume
   * which is which.
   *
   * Undefined where the jurisdiction has no such standard, or where it has not
   * been researched. Absent means the signal does not fire, never that the
   * property is compliant.
   */
  readonly lettingEnergyStandard?: LettingEnergyStandard;
}

export type EpcRating = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export interface LettingEnergyStandard {
  /** The worst rating that may still be let. */
  readonly minimumRating: EpcRating;
  /** When this became or becomes enforceable. ISO-8601. */
  readonly inForceFrom: string;
  readonly label: string;
  readonly citation: string;
}

export interface TransferTaxInput {
  readonly price: Money;
  readonly buyerOwnsOtherProperty: boolean;
  readonly buyerIsCompany: boolean;
  readonly buyerIsNonResident: boolean;
  readonly isResidential: boolean;
}

export interface ProfitTaxInput {
  /** Profit before tax, as computed by the appraisal engine. */
  readonly profitBeforeTax: Money;
  readonly buyerIsCompany: boolean;
  /** True where the strategy is trading (buy-refurbish-sell) rather than investment. */
  readonly isTrading: boolean;
  /** Rental profit over the hold period, taxed as income. */
  readonly rentalProfit: Money;
}

export interface ProfitTaxAssessment {
  readonly amount: Money;
  readonly label: string;
  /** Effective rate applied, basis points. */
  readonly effectiveRateBps: Bps;
  readonly basis: string;
  /** Always true: this is an estimate, never a substitute for advice. */
  readonly requiresProfessionalReview: true;
  readonly caveats: readonly string[];
}

export interface JurisdictionDefaults {
  readonly buyerLegal: Money;
  readonly survey: Money;
  /** Selling agent fee on exit, basis points of sale price. */
  readonly sellingAgentBps: Bps;
  readonly sellerLegalOnExit: Money;
  /** Monthly holding cost proxy: council tax, utilities, insurance. */
  readonly monthlyHoldingCost: Money;
  /** Contingency applied to works, basis points. */
  readonly contingencyBps: Bps;
  /** Share of rent lost to voids, management and maintenance, basis points. */
  readonly rentalLeakageBps: Bps;
}

export type StructurePermission =
  | "permitted"
  | "permitted-with-professional"
  | "regulated"
  | "not-supported";

export interface StructureRuling {
  readonly structure: StructureKind;
  readonly permission: StructurePermission;
  /** Plain-language explanation shown to the user, not just logged. */
  readonly note: string;
  /** Permissions or professional involvement required before proceeding. */
  readonly requires: readonly string[];
}

export interface RegulatoryObligation {
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  readonly authority: string;
}

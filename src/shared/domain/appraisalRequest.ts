import { bps, fromMajor, money, pct, ZERO, type Bps, type Money } from "@shared/money";
import { isDealReady } from "@shared/domain/jurisdictions";
import type {
  DealInputs,
  ExitStrategy,
  FinanceTerms,
  JurisdictionCode,
  PropertyFacts,
  SellerProfile,
  StructureKind,
} from "@shared/domain/types";

/**
 * A deal somebody typed in, turned into engine inputs.
 *
 * This exists so a stranger can appraise their own deal without an account,
 * without anything being stored, and without telling us who they are. That
 * constrains it in two ways worth stating.
 *
 * **It is buyer-side arithmetic only.** `appraise()` reads nothing from the
 * seller — verified, not assumed — so the cost stack, the tax, the true
 * discount and the exit are all computable from figures a buyer already has.
 * What is *not* computable is the Deal Score, because scoring runs Seller
 * Protection and the motivation diagnostics, and both need answers about a
 * person nobody here has spoken to. A score derived from a blank seller would
 * be a number with nothing behind it, and rule eight says absent screening
 * answers mean more caution rather than less. So this returns no score, and
 * the page says why.
 *
 * **Every default is declared.** A form with twenty fields gets abandoned; a
 * form with six fields and fourteen silent assumptions produces a figure the
 * reader believes and should not. So the short form carries defaults, and
 * `assumptionsOf()` returns every one that was applied, in the reader's words,
 * for display next to the result.
 */

export const APPRAISAL_VERSION = "appraisal-1";

/**
 * Finance terms for a deal where the visitor has not said how they are funding
 * it. Mid-market bridging as at the date below — not a quote, and not the
 * cheapest available.
 */
export const DEFAULT_FINANCE = {
  ltvBps: pct(70),
  refurbAdvanceBps: pct(100),
  annualRateBps: pct(11),
  arrangementFeeBps: pct(2),
  exitFeeBps: pct(1),
  interestRolledUp: true,
  lenderCosts: fromMajor(1_500),
  asOf: "2026-09-01",
} as const;

export const DEFAULT_HOLD_MONTHS = 9;

/** Where the visitor gives no post-works value, works are assumed to add cost only. */
export const DEFAULT_VALUATION_CONFIDENCE = pct(80);

/** The margin the walk-away price is solved for. */
export const TARGET_MARGIN_BPS = pct(15);

export interface AppraisalFields {
  readonly purchasePrice?: string;
  readonly marketValue?: string;
  readonly refurbishment?: string;
  readonly postWorksValue?: string;
  readonly monthlyRent?: string;
  readonly jurisdiction?: string;
  readonly propertyType?: string;
  readonly structure?: string;
  readonly exit?: string;
  readonly holdMonths?: string;
  readonly ltv?: string;
  readonly rate?: string;
  readonly company?: string;
  readonly ownsOther?: string;
  readonly nonResident?: string;
}

export interface Problem {
  readonly field: string;
  readonly message: string;
}

export type AppraisalParse =
  | { readonly ok: true; readonly inputs: DealInputs; readonly assumptions: readonly string[] }
  | { readonly ok: false; readonly problems: readonly Problem[] };

const JURISDICTIONS: readonly { code: JurisdictionCode; label: string }[] = [
  { code: "GB-ENG", label: "England" },
  { code: "GB-NIR", label: "Northern Ireland" },
  { code: "GB-SCT", label: "Scotland" },
];

/** Only jurisdictions whose rate tables have been verified are offered. */
export const APPRAISAL_JURISDICTIONS = JURISDICTIONS.filter((j) => isDealReady(j.code));

export const APPRAISAL_STRUCTURES: readonly { value: StructureKind; label: string }[] = [
  { value: "bridging-refurb-refinance", label: "Bridge, refurbish, refinance" },
  { value: "cash-purchase", label: "Cash purchase" },
  { value: "private-money-purchase", label: "Private money purchase" },
];

export const APPRAISAL_EXITS: readonly { value: ExitStrategy; label: string }[] = [
  { value: "sell", label: "Sell on completion of works" },
  { value: "refinance-and-hold", label: "Refinance and hold" },
];

/**
 * Money from a string a person typed.
 *
 * Accepts "£172,000", "172000", "172,000.50". Returns undefined rather than
 * zero for anything unparseable — zero is a figure, and a figure nobody
 * entered must never reach the engine.
 */
function parseMoney(raw: string | undefined): Money | undefined {
  if (raw === undefined) return undefined;
  const cleaned = raw.replace(/[£,\s]/g, "");
  if (cleaned === "") return undefined;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return money(Math.round(value * 100));
}

function parseCount(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function parsePercent(raw: string | undefined): Bps | undefined {
  const value = parseCount(raw);
  if (value === undefined || value < 0 || value > 100) return undefined;
  return bps(Math.round(value * 100));
}

function oneOf<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
): { value: T; defaulted: boolean } {
  const found = allowed.find((a) => a === raw);
  return found === undefined ? { value: fallback, defaulted: true } : { value: found, defaulted: false };
}

/** True where enough has been entered to attempt an appraisal at all. */
export function hasSubmission(fields: AppraisalFields): boolean {
  return (
    (fields.purchasePrice ?? "").trim() !== "" ||
    (fields.marketValue ?? "").trim() !== "" ||
    (fields.refurbishment ?? "").trim() !== ""
  );
}

export function parseAppraisal(fields: AppraisalFields): AppraisalParse {
  const problems: Problem[] = [];
  const assumptions: string[] = [];

  const purchasePrice = parseMoney(fields.purchasePrice);
  const marketValue = parseMoney(fields.marketValue);
  const refurbishment = parseMoney(fields.refurbishment) ?? ZERO;

  if (purchasePrice === undefined || purchasePrice <= ZERO) {
    problems.push({ field: "purchasePrice", message: "Enter the price you would pay." });
  }
  if (marketValue === undefined || marketValue <= ZERO) {
    problems.push({
      field: "marketValue",
      message: "Enter what it is worth today, as it stands. Without it there is no discount to measure.",
    });
  }

  const jurisdiction = oneOf(
    fields.jurisdiction,
    APPRAISAL_JURISDICTIONS.map((j) => j.code),
    "GB-ENG",
  );
  if (jurisdiction.defaulted) {
    assumptions.push("England, for the transfer tax and the profit tax.");
  }

  const structure = oneOf(
    fields.structure,
    APPRAISAL_STRUCTURES.map((s) => s.value),
    "bridging-refurb-refinance",
  );
  const exit = oneOf(fields.exit, APPRAISAL_EXITS.map((e) => e.value), "sell");

  const holdMonths = parseCount(fields.holdMonths);
  if (holdMonths !== undefined && (holdMonths < 1 || holdMonths > 60)) {
    problems.push({ field: "holdMonths", message: "A hold between 1 and 60 months." });
  }
  const hold = holdMonths ?? DEFAULT_HOLD_MONTHS;
  if (holdMonths === undefined) {
    assumptions.push(`A ${DEFAULT_HOLD_MONTHS}-month hold from completion to exit.`);
  }

  if (problems.length > 0 || purchasePrice === undefined || marketValue === undefined) {
    return { ok: false, problems };
  }

  // No post-works value given means the works are modelled as adding their own
  // cost and nothing more. That is deliberately pessimistic: assuming an uplift
  // nobody entered is how a refurbishment appraisal flatters itself.
  const givenPostWorks = parseMoney(fields.postWorksValue);
  const postWorksValue = givenPostWorks ?? money(marketValue + refurbishment);
  if (givenPostWorks === undefined && refurbishment > ZERO) {
    assumptions.push(
      "No value after works given, so the works are modelled as adding exactly what they cost and no more.",
    );
  }

  const monthlyRent = parseMoney(fields.monthlyRent) ?? ZERO;
  if (exit.value === "refinance-and-hold" && monthlyRent <= ZERO) {
    problems.push({
      field: "monthlyRent",
      message: "A refinance exit is judged on the rent. Enter the monthly rent, or choose a sale exit.",
    });
    return { ok: false, problems };
  }

  const ltv = parsePercent(fields.ltv);
  const rate = parsePercent(fields.rate);
  if (structure.value !== "cash-purchase" && ltv === undefined && rate === undefined) {
    assumptions.push(
      `Finance at ${DEFAULT_FINANCE.ltvBps / 100}% loan to value and ${DEFAULT_FINANCE.annualRateBps / 100}% a year, with a ${DEFAULT_FINANCE.arrangementFeeBps / 100}% arrangement fee and a ${DEFAULT_FINANCE.exitFeeBps / 100}% exit fee, interest retained. Mid-market bridging as at ${DEFAULT_FINANCE.asOf} — not a quote.`,
    );
  }

  const finance: FinanceTerms =
    structure.value === "cash-purchase"
      ? {
          ltvBps: bps(0),
          refurbAdvanceBps: bps(0),
          annualRateBps: bps(0),
          arrangementFeeBps: bps(0),
          exitFeeBps: bps(0),
          interestRolledUp: false,
          lenderCosts: ZERO,
        }
      : {
          ltvBps: ltv ?? DEFAULT_FINANCE.ltvBps,
          refurbAdvanceBps: DEFAULT_FINANCE.refurbAdvanceBps,
          annualRateBps: rate ?? DEFAULT_FINANCE.annualRateBps,
          arrangementFeeBps: DEFAULT_FINANCE.arrangementFeeBps,
          exitFeeBps: DEFAULT_FINANCE.exitFeeBps,
          interestRolledUp: DEFAULT_FINANCE.interestRolledUp,
          lenderCosts: DEFAULT_FINANCE.lenderCosts,
        };

  const company = fields.company === "on" || fields.company === "true";
  const ownsOther = fields.ownsOther !== "off" && fields.ownsOther !== "false";
  const nonResident = fields.nonResident === "on" || fields.nonResident === "true";
  if (!company && fields.company === undefined) {
    assumptions.push(
      "Bought by an individual who already owns another dwelling, so the higher rate of transfer tax applies and profit is taxed at income rates.",
    );
  }

  const property: PropertyFacts = {
    id: "appraisal",
    jurisdiction: jurisdiction.value,
    postcodeArea: "",
    locality: "",
    propertyType: "house",
    tenure: "freehold",
    bedrooms: 3,
    occupancy: "vacant",
    openMarketValue: marketValue,
    valuationConfidence: DEFAULT_VALUATION_CONFIDENCE,
    refurbishmentEstimate: refurbishment,
    postWorksValue,
    monthlyRent,
    knownIssues: [],
  };

  // Present because DealInputs requires it, and read by nothing this page
  // calls. `appraise()` touches no seller field; the engines that would —
  // Seller Protection and the motivation diagnostics — are deliberately not
  // run, because there is no seller here to have answered them.
  const seller: SellerProfile = {
    situation: "vacant-property",
    priorities: [],
    screening: {},
  };

  return {
    ok: true,
    assumptions,
    inputs: {
      property,
      seller,
      purchasePrice,
      buyerOwnsOtherProperty: ownsOther,
      buyerIsCompany: company,
      buyerIsNonResident: nonResident,
      holdMonths: hold,
      structure: structure.value,
      finance,
      exit: exit.value,
    },
  };
}

/** The query string that reproduces a result, for sharing and for the browser's back button. */
export function toQuery(fields: AppraisalFields): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string" && value.trim() !== "") params.set(key, value.trim());
  }
  return params.toString();
}

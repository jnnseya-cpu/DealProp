import { bps, scale, type Bps, type Money } from "@shared/money";
import { getJurisdiction } from "@shared/domain/jurisdictions";
import type { EpcRating } from "@shared/domain/jurisdictions/types";
import type { JurisdictionCode } from "@shared/domain/types";
import type { SourceAttribution } from "@shared/domain/sources";

/**
 * Opportunity signals built from public records rather than portal listings.
 *
 * `ListingSignal` in `goldmine.ts` describes a property that is *advertised*:
 * days on market, reductions, relists, agent changes. Every one of those fields
 * can only come from a portal, and no portal permits taking them. That is why
 * GoldMine was never wired up.
 *
 * This is the same question answered from a different direction. A motivated
 * sale is not only visible in how a listing behaves; it is visible in what the
 * public record already says about the property and its owner:
 *
 *  - **Years since last sale.** Long tenure means accumulated equity, which is
 *    what makes a discount affordable to the seller rather than impossible.
 *  - **An EPC lodged with no sale following.** An EPC is a legal precondition
 *    of marketing. One lodged eighteen months ago with no transfer recorded
 *    means a sale was prepared and did not happen.
 *  - **A rating below the letting standard.** Where the jurisdiction has one,
 *    the owner must spend money or stop letting. That is a decision with a
 *    statutory deadline behind it.
 *  - **A dissolved or insolvent corporate owner.** A forced disposal.
 *  - **Long-term empty.** The strongest signal there is, and the only one that
 *    needs a relationship rather than a download.
 *
 * Every field is optional. Absent means unknown, and unknown lowers confidence
 * rather than raising a score — the same rule the Seller Protection Engine
 * follows for missing screening answers.
 */

export type OwnerKind = "individual" | "uk-company" | "overseas-company";

export interface RegistrySignal {
  readonly propertyId: string;
  readonly jurisdiction: JurisdictionCode;
  /** Where each fact came from, and under what licence. Never empty. */
  readonly sources: readonly SourceAttribution[];

  /** From Price Paid Data. */
  readonly lastSalePrice?: Money;
  /** ISO-8601 date of the last recorded sale. */
  readonly lastSaleDate?: string;

  /** From the EPC register. */
  readonly epcRating?: EpcRating;
  /** ISO-8601 date the EPC was lodged. */
  readonly epcLodgedAt?: string;
  readonly floorAreaSqm?: number;

  /** From corporate ownership data and Companies House. */
  readonly ownerKind?: OwnerKind;
  readonly ownerDissolvedOrInsolvent?: boolean;

  /** From a council partnership, where one exists. */
  readonly longTermEmpty?: boolean;

  /** Median £/sqm for comparable local stock, from Price Paid Data. */
  readonly localMedianPricePerSqm?: Money;
  /** Current open market value estimate, where one has been formed. */
  readonly estimatedValue?: Money;
}

/** Long enough that a sale was prepared and then did not happen. */
const STALE_EPC_MONTHS = 12;
/** Tenure beyond which meaningful equity has usually accumulated. */
const LONG_TENURE_YEARS = 15;

export interface RegistryFactor {
  readonly key: string;
  readonly label: string;
  /** Points contributed, 0-100 before weighting. */
  readonly weight: number;
  /** Why this fired, in the terms a person would use. */
  readonly detail: string;
}

export interface RegistryPressureResult {
  /** 0-100. How likely this owner is to want a solution rather than a price. */
  readonly score: number;
  readonly factors: readonly RegistryFactor[];
  /**
   * 0-10,000 bps. How much of the picture we actually have. A high score built
   * on two fields is not the same as a high score built on six, and presenting
   * them identically is how a screening tool starts lying.
   */
  readonly confidenceBps: Bps;
  /** Fields that would most improve the assessment, most valuable first. */
  readonly missing: readonly string[];
  readonly summary: string;
}

function monthsBetween(from: string, to: Date): number {
  const start = new Date(from);
  if (Number.isNaN(start.getTime())) return 0;
  return (to.getFullYear() - start.getFullYear()) * 12 + (to.getMonth() - start.getMonth());
}

const RATING_ORDER: readonly EpcRating[] = ["A", "B", "C", "D", "E", "F", "G"];

/** True where `rating` is worse than `minimum`. */
export function belowStandard(rating: EpcRating, minimum: EpcRating): boolean {
  return RATING_ORDER.indexOf(rating) > RATING_ORDER.indexOf(minimum);
}

/**
 * Score owner motivation from public records.
 *
 * `now` is injected rather than read from the clock so the result is
 * reproducible: a screening figure that changes because a test ran after
 * midnight is not a figure anyone can audit.
 */
export function registryPressure(
  signal: RegistrySignal,
  now: Date = new Date(),
): RegistryPressureResult {
  const factors: RegistryFactor[] = [];
  const missing: string[] = [];

  // --- Forced action --------------------------------------------------------

  if (signal.longTermEmpty === true) {
    factors.push({
      key: "long-term-empty",
      label: "Long-term empty",
      weight: 30,
      detail:
        "An empty property costs its owner money every month and returns nothing. This is the strongest single indicator that the owner wants the problem gone.",
    });
  } else if (signal.longTermEmpty === undefined) {
    missing.push("Whether the property is recorded as long-term empty");
  }

  if (signal.ownerDissolvedOrInsolvent === true) {
    factors.push({
      key: "owner-insolvent",
      label: "Corporate owner dissolved or insolvent",
      weight: 25,
      detail:
        "The property must be disposed of by an office-holder to a timetable that is not theirs. Treat with care: an insolvency practitioner is not a vulnerable seller, but a beneficial owner behind one may be.",
    });
  }

  const standard = getJurisdiction(signal.jurisdiction).lettingEnergyStandard;
  if (standard !== undefined && signal.epcRating !== undefined) {
    if (belowStandard(signal.epcRating, standard.minimumRating)) {
      factors.push({
        key: "below-letting-standard",
        label: `Below the ${standard.label} threshold`,
        weight: 22,
        detail: `Rated ${signal.epcRating} against a minimum of ${standard.minimumRating}. The owner must spend money on it or stop letting it, and that decision has a statutory deadline rather than an open one.`,
      });
    }
  } else if (signal.epcRating === undefined) {
    missing.push("EPC rating");
  }

  // --- A sale that was prepared and did not happen ---------------------------

  if (signal.epcLodgedAt !== undefined) {
    const age = monthsBetween(signal.epcLodgedAt, now);
    const soldSince =
      signal.lastSaleDate !== undefined && signal.lastSaleDate > signal.epcLodgedAt;
    if (age >= STALE_EPC_MONTHS && !soldSince) {
      factors.push({
        key: "stale-epc-no-sale",
        label: "Marketing prepared, no sale followed",
        weight: 20,
        detail: `An EPC was lodged ${age} months ago and no transfer has been registered since. An EPC is a legal precondition of marketing, so somebody prepared to sell and it did not complete.`,
      });
    }
  } else {
    missing.push("EPC lodgement date");
  }

  // --- Capacity to accept a discount ----------------------------------------

  if (signal.lastSaleDate !== undefined) {
    const years = Math.floor(monthsBetween(signal.lastSaleDate, now) / 12);
    if (years >= LONG_TENURE_YEARS) {
      factors.push({
        key: "long-tenure",
        label: `Held ${years} years`,
        weight: 12,
        detail:
          "Long ownership usually means accumulated equity, which is what makes a below-market price acceptable to a seller rather than impossible for them.",
      });
    }
  } else {
    missing.push("Last sale date");
  }

  if (signal.ownerKind === "overseas-company") {
    factors.push({
      key: "overseas-owner",
      label: "Overseas corporate owner",
      weight: 10,
      detail:
        "A distant owner manages the asset at arm's length and tends to value a clean exit over the last few percent of price.",
    });
  } else if (signal.ownerKind === undefined) {
    missing.push("Owner type");
  }

  // --- Value context ---------------------------------------------------------

  if (signal.floorAreaSqm === undefined) {
    missing.push("Floor area (turns a price into £/sqm, which is comparable)");
  }
  if (signal.localMedianPricePerSqm === undefined) {
    missing.push("Local median £/sqm");
  }

  const score = Math.min(
    100,
    factors.reduce((total, f) => total + f.weight, 0),
  );

  // Confidence is the share of the fields that carry signal which we actually
  // hold. Eight are counted because that is how many the scorer can use.
  const known = [
    signal.longTermEmpty,
    signal.ownerDissolvedOrInsolvent,
    signal.epcRating,
    signal.epcLodgedAt,
    signal.lastSaleDate,
    signal.lastSalePrice,
    signal.ownerKind,
    signal.floorAreaSqm,
  ].filter((v) => v !== undefined).length;
  const confidenceBps = bps(Math.round((known / 8) * 10_000));

  return {
    score,
    factors,
    confidenceBps,
    missing,
    summary: summarise(score, confidenceBps, factors.length),
  };
}

function summarise(score: number, confidenceBps: Bps, factorCount: number): string {
  if (factorCount === 0) {
    return "Nothing in the public record suggests this owner wants a solution. That is a statement about the records held, not about the owner.";
  }
  const strength =
    score >= 60 ? "Strong" : score >= 35 ? "Worth approaching" : "Weak but not nothing";
  const confidence =
    confidenceBps >= 7_500
      ? "on a reasonably complete record"
      : confidenceBps >= 5_000
        ? "on a partial record"
        : "on very little data, so treat it as a prompt to look rather than a conclusion";
  return `${strength}: ${factorCount} ${factorCount === 1 ? "indicator" : "indicators"}, ${confidence}.`;
}

/**
 * £ per square metre, the comparison that actually works.
 *
 * Bedroom count is what portals index on and it is close to useless for
 * comparison: a three-bed terrace can be 70sqm or 110sqm and the difference is
 * the entire margin. Floor area comes free with every EPC.
 */
export function pricePerSqm(price: Money, floorAreaSqm: number): Money | undefined {
  if (floorAreaSqm <= 0) return undefined;
  // scale() rather than raw division: Money is branded precisely to stop
  // arithmetic that escapes the deterministic rounding.
  return scale(price, 1 / floorAreaSqm);
}

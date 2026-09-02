import type { DealStatus, JurisdictionCode } from "@shared/domain/types";

/**
 * How much supply this platform actually has.
 *
 * An investor's first question is not what the appraisal engine does. It is
 * how many deals, where, and how often — because an analysis tool with no
 * supply behind it is a spreadsheet with better manners. The landing page
 * answered none of the three, and the figures it did show ("verified buyers:
 * 1") were read from the seed fixtures rather than from the platform, on a page
 * whose stated claim is that every number is computed.
 *
 * So this computes the answer from the records that exist, and the answer is
 * allowed to be small. A live count of four is more persuasive than silence,
 * because a reader who cannot find a number assumes the worst one — and because
 * a figure that moves when the platform moves is the only kind worth believing.
 *
 * **What it deliberately does not report is any return.** A public statement
 * that deals are available at a given margin is an inducement to engage in
 * investment activity, which under FSMA s.21 may only be communicated or
 * approved by an authorised person. Counts, coverage, cadence and the refusal
 * rate are statements of fact about the business rather than about an
 * investment, and they are what an investor is actually asking for. The
 * economics stay behind categorisation, where `can()` already puts them.
 */

export interface SupplyRecord {
  readonly createdAt: string;
  readonly status: DealStatus;
  readonly postcodeArea: string;
  readonly locality: string;
  readonly jurisdiction: JurisdictionCode;
  /** True where Seller Protection stopped it reaching capital. */
  readonly blocked: boolean;
}

/** Statuses that describe a deal a buyer could still act on. */
const OPEN: ReadonlySet<DealStatus> = new Set<DealStatus>(["new", "qualified", "in-market"]);

export const RECENT_DAYS = 30;

export interface SupplyPosition {
  /** Deals a buyer could act on today, excluding anything protection blocked. */
  readonly open: number;
  /** Everything on the platform, whatever its state. */
  readonly total: number;
  readonly blocked: number;
  readonly completed: number;
  /** Postcode areas with at least one open deal, alphabetical. */
  readonly areas: readonly string[];
  readonly localities: readonly string[];
  readonly jurisdictions: readonly JurisdictionCode[];
  /** Added in the last RECENT_DAYS. */
  readonly recent: number;
  /** Mean days between the deals on record. Undefined below two. */
  readonly meanDaysBetween?: number;
  readonly firstAt?: string;
  readonly latestAt?: string;
  /** Buy Boxes and Funding Boxes recorded, active only. */
  readonly buyMandates: number;
  readonly fundingMandates: number;
  /**
   * What this position honestly is, in a sentence a reader can act on.
   *
   * Written from the figures rather than chosen from a list of flattering
   * phrases, and it says "early" when it is early.
   */
  readonly summary: string;
  /** True where there is not yet enough here for a rate to mean anything. */
  readonly tooEarlyForCadence: boolean;
}

function daysBetween(from: string, to: Date): number | undefined {
  const then = new Date(from);
  if (Number.isNaN(then.getTime())) return undefined;
  return Math.floor((to.getTime() - then.getTime()) / 86_400_000);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function supplyPosition(
  deals: readonly SupplyRecord[],
  mandates: { readonly buy: number; readonly funding: number },
  now: Date = new Date(),
): SupplyPosition {
  const open = deals.filter((d) => OPEN.has(d.status) && !d.blocked);
  const blocked = deals.filter((d) => d.blocked).length;
  const completed = deals.filter((d) => d.status === "completed" || d.status === "funded").length;

  const recent = deals.filter((d) => {
    const age = daysBetween(d.createdAt, now);
    return age !== undefined && age >= 0 && age <= RECENT_DAYS;
  }).length;

  const dated = deals
    .map((d) => d.createdAt)
    .filter((at) => !Number.isNaN(new Date(at).getTime()))
    .sort();
  const firstAt = dated[0];
  const latestAt = dated[dated.length - 1];

  // Cadence needs at least two points and a span, or it is arithmetic on
  // nothing: two deals entered on the same afternoon are not "one every zero
  // days", they are a seeding.
  let meanDaysBetween: number | undefined;
  if (dated.length >= 2 && firstAt !== undefined && latestAt !== undefined) {
    const span = Math.floor(
      (new Date(latestAt).getTime() - new Date(firstAt).getTime()) / 86_400_000,
    );
    if (span > 0) meanDaysBetween = Math.round(span / (dated.length - 1));
  }

  const tooEarlyForCadence = meanDaysBetween === undefined || deals.length < 8;

  const areas = unique(open.map((d) => d.postcodeArea).filter((a) => a !== "")).sort();
  const localities = unique(open.map((d) => d.locality).filter((l) => l !== "")).sort();
  const jurisdictions = unique(deals.map((d) => d.jurisdiction)).sort();

  return {
    open: open.length,
    total: deals.length,
    blocked,
    completed,
    areas,
    localities,
    jurisdictions,
    recent,
    ...(meanDaysBetween !== undefined ? { meanDaysBetween } : {}),
    ...(firstAt !== undefined ? { firstAt } : {}),
    ...(latestAt !== undefined ? { latestAt } : {}),
    buyMandates: mandates.buy,
    fundingMandates: mandates.funding,
    summary: summarise(open.length, deals.length, blocked, areas, recent, tooEarlyForCadence),
    tooEarlyForCadence,
  };
}

function summarise(
  open: number,
  total: number,
  blocked: number,
  areas: readonly string[],
  recent: number,
  tooEarly: boolean,
): string {
  if (total === 0) {
    return "No deals are on the platform yet. There is nothing here to match a mandate against, and saying otherwise would be the first thing you found out was untrue.";
  }

  const where =
    areas.length === 0
      ? ""
      : areas.length === 1
        ? ` in ${areas[0]}`
        : ` across ${areas.length} postcode areas (${areas.join(", ")})`;

  const refused =
    blocked === 0
      ? ""
      : ` ${blocked} more ${blocked === 1 ? "was" : "were"} refused by the protection engine and ${blocked === 1 ? "is" : "are"} not shown to anybody.`;

  if (tooEarly) {
    return `${open} open ${open === 1 ? "opportunity" : "opportunities"}${where}, from ${total} on the platform in total.${refused} That is early-stage volume and it is stated rather than dressed up: there is not yet enough history here for a rate to mean anything.`;
  }

  return `${open} open ${open === 1 ? "opportunity" : "opportunities"}${where}, from ${total} on the platform in total, ${recent} added in the last ${RECENT_DAYS} days.${refused}`;
}

/* ----------------------------------------------------------- launch focus */

/**
 * Where this platform is concentrating, and on what.
 *
 * A statement of strategy rather than of inventory, and the distinction
 * matters: "we are focusing on the West Midlands" is true on day one, and "we
 * have deals across the West Midlands" is a claim that has to be counted.
 * `focusCoverage()` below keeps the two apart, and reports honestly when the
 * real coverage has drifted outside what the page says.
 *
 * Concentrated deliberately. A marketplace thin across the whole country is
 * useless to everybody in it; the same number of deals inside one travel-to-work
 * area is a market. The postcode areas are the West Midlands conurbation.
 */
export const LAUNCH_REGION = {
  label: "Birmingham and the West Midlands",
  postcodeAreas: ["B", "CV", "DY", "WS", "WV"] as readonly string[],
} as const;

/**
 * The stock this is built for.
 *
 * Every one of them is a property an ordinary agent struggles with, which is
 * exactly why the seller is reachable and the buyer is a professional. A
 * chain-free vacant refurbishment is not a compromise on the sort of stock we
 * would rather have — it is the stock the engine is for.
 */
export const LAUNCH_FOCUS: readonly string[] = [
  "Vacant residential property",
  "Chain-free sales",
  "Landlord portfolio disposals",
  "Refurbishment properties",
  "Unsold auction lots",
  "Property returning after a failed sale",
  "Buyers needing bridging finance",
  "Cash investors and small developers",
];

export interface FocusCoverage {
  /** Postcode areas on the platform that are inside the launch region. */
  readonly inside: readonly string[];
  /** Areas outside it. Reported rather than hidden — see below. */
  readonly outside: readonly string[];
  readonly statement: string;
}

/**
 * How the real coverage compares with the stated focus.
 *
 * Reported rather than quietly reconciled. A page that says "the West
 * Midlands" while the pipeline is half in Leeds is a page whose first
 * checkable claim is wrong, and a reader who catches one stops believing the
 * rest — including the figures that are true.
 */
export function focusCoverage(areas: readonly string[]): FocusCoverage {
  // Postcode areas are the letters at the front: "B23" is in "B".
  const letters = (area: string): string => area.replace(/[0-9].*$/, "").toUpperCase();
  const inside = areas.filter((a) => LAUNCH_REGION.postcodeAreas.includes(letters(a)));
  const outside = areas.filter((a) => !LAUNCH_REGION.postcodeAreas.includes(letters(a)));

  if (areas.length === 0) {
    return {
      inside,
      outside,
      statement: `Concentrating on ${LAUNCH_REGION.label}. Nothing is on the platform yet.`,
    };
  }
  if (outside.length === 0) {
    return {
      inside,
      outside,
      statement: `Concentrating on ${LAUNCH_REGION.label}, and every open opportunity is inside it.`,
    };
  }
  return {
    inside,
    outside,
    statement: `Concentrating on ${LAUNCH_REGION.label}. ${outside.length} of ${areas.length} postcode ${areas.length === 1 ? "area is" : "areas are"} outside it — ${outside.join(", ")} — which is stated rather than tidied away.`,
  };
}

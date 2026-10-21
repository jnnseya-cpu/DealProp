import type { SignalKey } from "@shared/domain/sourcingSignals";

/**
 * The shape of a licensed listing-data provider, and nothing about any one.
 *
 * Seven of the strategy signals in `sourcingSignals.ts` are facts about a live
 * portal listing — back and reduced, withdrawn, sold STC, cash only — and this
 * platform does not read portals. The lawful way to have them is a licensed
 * reseller that already holds the portal agreements and sells the signals
 * through an API: PropertyData, Sprift, LandInsight and the like. Dryv, the
 * tool whose filter panel prompted this, is built on exactly such a feed.
 *
 * This file is the shape of that answer, not the provider — the same decision
 * `screening.ts` and `stripe.ts` make. It defines what a listing observation
 * is and what a provider must return, so wiring a reseller later is an adapter
 * rather than a change to everything that reads a signal. Until one is wired
 * the provider is absent and the dependent signals stay refused, which is the
 * honest state and the one the taxonomy already shows.
 *
 * Three rules this port exists to keep:
 *
 *  1. **A licence, never a scrape.** A conforming adapter calls a provider's
 *     API under a contract. There is no adapter in this codebase that fetches
 *     a portal page, and `copy-listings` remains a §20 prohibition. An adapter
 *     that scraped would be a breach dressed as an integration.
 *  2. **Provenance travels.** Every observation names the provider it came
 *     from and when it was seen, so a signal can be aged out and a dispute can
 *     be traced to a source rather than to "the system".
 *  3. **Absent is a first-class answer.** No provider means the signal is
 *     unknown, not false. A property with no listing observation is one we
 *     have no portal data on — which is different from one we know is not
 *     reduced, and the type keeps them different.
 */

export const LISTING_DATA_VERSION = "listing-data-1";

/** The listing signals a provider can carry — the portal-dependent subset. */
export type ListingSignalKey = Extract<
  SignalKey,
  | "back-and-reduced"
  | "withdrawn-recently"
  | "sold-stc-stalled"
  | "cash-only"
  | "no-chain"
  | "currently-tenanted"
  | "repossessed"
>;

/** One observation about one property's listing, from one provider. */
export interface ListingObservation {
  readonly signal: ListingSignalKey;
  /** True where the provider asserts the signal holds for this property. */
  readonly present: boolean;
  /**
   * Supporting detail, verbatim from the provider where it gives one — the
   * reduction amount, the date withdrawn, the days since sold STC. Never
   * synthesised: an observation this platform cannot attribute is not made.
   */
  readonly detail?: string;
  /** ISO-8601. When the provider observed it, not when we read it. */
  readonly observedAt: string;
}

export interface ListingReport {
  /** Which provider answered. Named, so provenance is never "the system". */
  readonly provider: string;
  /** ISO-8601, when this platform asked. */
  readonly retrievedAt: string;
  readonly observations: readonly ListingObservation[];
}

/**
 * A query a provider can answer. A specific property, by its address — because
 * a provider is asked about a property genuinely being pursued, not swept for
 * a postcode, which is the same discipline the title reader keeps.
 */
export interface ListingQuery {
  readonly postcode: string;
  readonly paon: string;
  readonly saon?: string;
  readonly street: string;
}

/**
 * The port. An adapter for one reseller implements this and nothing wider.
 *
 * Returns undefined where it has no data on a property, which a provider does
 * for most of the stock — absence is the common case and must not read as a
 * negative.
 */
export interface ListingDataProvider {
  readonly name: string;
  lookup(query: ListingQuery): Promise<ListingReport | undefined>;
}

export type ListingAvailability =
  | { readonly configured: true; readonly provider: string }
  | { readonly configured: false; readonly reason: string };

/**
 * Whether a provider is wired, for a surface to show the honest state.
 *
 * Fails closed: with nothing configured the dependent signals are refused, and
 * the reason says the gap is a contract rather than a bug — the same sentence
 * the source registry uses for the portals themselves.
 */
export function listingAvailability(
  provider: ListingDataProvider | undefined,
): ListingAvailability {
  if (provider === undefined) {
    return {
      configured: false,
      reason:
        "No licensed listing-data provider is configured, so the portal-dependent signals are refused. They need a commercial feed from a reseller such as PropertyData, Sprift or LandInsight — a contract, not a scraper. Once one is wired, these flip from refused to live without any other change.",
    };
  }
  return { configured: true, provider: provider.name };
}

/**
 * Turn a provider's observations into the signal keys that currently hold.
 *
 * The join between a licensed feed and the strategy taxonomy: only
 * observations the provider marks present, and only within a freshness window,
 * because a reduction from a year ago is not a motivated seller today.
 */
export function signalsFrom(
  report: ListingReport,
  now: Date = new Date(),
  maxAgeDays = 90,
): readonly ListingSignalKey[] {
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  return report.observations
    .filter((observation) => observation.present)
    .filter((observation) => {
      const at = Date.parse(observation.observedAt);
      return !Number.isNaN(at) && at >= cutoff;
    })
    .map((observation) => observation.signal);
}

/**
 * Data sources and the licences that permit their use.
 *
 * GoldMine was left unwired because the obvious input — portal listings — is
 * the one input nobody may lawfully take. The major portals prohibit scraping
 * in their terms, and property data carries licensing and data-protection
 * obligations on top of that.
 *
 * The alternative is not a cleverer scraper. It is different data. The United
 * Kingdom publishes, under open licences, most of what actually predicts a
 * motivated sale: when a property last sold and for how much, its floor area
 * and energy rating, whether an EPC was lodged and nothing followed, and who
 * owns it. None of that is listing data and none of it needs a portal.
 *
 * This module is the gate. A source cannot be used unless its licence is
 * recorded and permits the use, exactly as `dealRevenue()` excludes any stream
 * whose permission is not held. Connecting a source stays a legal decision;
 * what changes is that the decision is now enforced by code rather than
 * remembered.
 */

/** How a source may be used. Narrower than the licence text; deliberately so. */
export type PermittedUse =
  /** Internal analysis only. Nothing derived may be shown to a third party. */
  | "internal-analysis"
  /** May be shown to users of the platform. */
  | "display"
  /** May be redistributed, e.g. inside a memorandum that leaves the building. */
  | "redistribute";

export interface SourceLicence {
  readonly name: string;
  /** Where the licence text lives, so a reviewer can read it. */
  readonly url: string;
  readonly permits: readonly PermittedUse[];
  /**
   * Attribution the licence requires wherever derived data appears. Empty
   * where none is required; never guessed.
   */
  readonly attribution?: string;
  /** True where a registration, key or signed agreement is needed first. */
  readonly requiresRegistration: boolean;
}

export interface DataSource {
  readonly key: string;
  readonly name: string;
  readonly publisher: string;
  /** What this source actually tells us, in one line. */
  readonly provides: string;
  readonly licence?: SourceLicence;
  /**
   * Why a source has no licence recorded. Present only where `licence` is
   * absent, so the gap is described rather than silent.
   */
  readonly unlicensedReason?: string;
}

const OGL: SourceLicence = {
  name: "Open Government Licence v3.0",
  url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  permits: ["internal-analysis", "display", "redistribute"],
  attribution: "Contains HM Land Registry data © Crown copyright and database right",
  requiresRegistration: false,
};

const EPC_LICENCE: SourceLicence = {
  name: "Energy Performance of Buildings Data England and Wales licence",
  url: "https://epc.opendatacommunities.org/docs/copyright",
  permits: ["internal-analysis", "display"],
  attribution: "Contains EPC data © Crown copyright",
  // Free, but an account and API key are required and the terms are accepted
  // at registration. That acceptance is the licence.
  requiresRegistration: true,
};

/**
 * The sources this platform knows about.
 *
 * Portal listings appear here deliberately, with no licence and a reason. A
 * source that is simply absent from a list looks like an oversight; one that is
 * present and refused is a decision somebody made.
 */
export const DATA_SOURCES: readonly DataSource[] = [
  {
    key: "land-registry-ppd",
    name: "Price Paid Data",
    publisher: "HM Land Registry",
    provides:
      "Every registered sale in England and Wales: price, date, postcode, property type, tenure, and whether the sale was at arm's length.",
    licence: OGL,
  },
  {
    key: "epc-register",
    name: "Energy Performance of Buildings Register",
    publisher: "Department for Levelling Up, Housing and Communities",
    provides:
      "Floor area, energy rating, lodgement date, heating and construction age band for any property with an EPC.",
    licence: EPC_LICENCE,
  },
  {
    key: "land-registry-corporate",
    name: "Commercial and Corporate Ownership Data",
    publisher: "HM Land Registry",
    provides: "Titles held by UK companies, which identifies corporate landlords.",
    licence: {
      ...OGL,
      name: "HM Land Registry Open Data licence",
      url: "https://use-land-property-data.service.gov.uk/",
      requiresRegistration: true,
    },
  },
  {
    key: "companies-house",
    name: "Companies House public data",
    publisher: "Companies House",
    provides:
      "Company status, so a corporate owner in liquidation or dissolution can be identified.",
    licence: OGL,
  },
  {
    key: "seller-intake",
    name: "Seller enquiry",
    publisher: "The seller",
    provides: "Everything the seller chose to tell us, given for the purpose of being helped.",
    licence: {
      name: "Given by the seller for this purpose",
      url: "/legal/privacy",
      // Deliberately not redistributable. A seller describing their divorce to
      // get help selling has not agreed to that reaching an investor pack.
      permits: ["internal-analysis"],
      requiresRegistration: false,
    },
  },
  {
    key: "portal-listings",
    name: "Property portal listings",
    publisher: "Rightmove, Zoopla, OnTheMarket",
    provides: "Asking price, days on market, reductions, relists, agent changes, photographs.",
    unlicensedReason:
      "The portals' terms prohibit scraping and automated collection. Use requires a commercial data agreement with the portal, or a licensed reseller such as PropertyData, Sprift or LandInsight. Until one exists this source must not be read.",
  },
  {
    key: "auction-unsold",
    name: "Auction unsold-lot lists",
    publisher: "Auction houses",
    provides: "Lots that failed to sell, with reserve and guide, straight from the auctioneer.",
    unlicensedReason:
      "Available by asking the auctioneer rather than by taking it. Record the agreement here as a licence before reading any feed.",
  },
];

export function getSource(key: string): DataSource | undefined {
  return DATA_SOURCES.find((s) => s.key === key);
}

export class SourceNotPermitted extends Error {
  constructor(
    readonly sourceKey: string,
    readonly use: PermittedUse,
    reason: string,
  ) {
    super(`${sourceKey} may not be used for ${use}: ${reason}`);
    this.name = "SourceNotPermitted";
  }
}

/**
 * Assert a source may be used this way, or refuse.
 *
 * Throws rather than returning false. A boolean gets ignored; a throw at the
 * point of ingestion cannot be, and ingestion is where the legal exposure is
 * created — not at the point of display.
 */
export function assertSourceUsable(key: string, use: PermittedUse): DataSource {
  const source = getSource(key);
  if (source === undefined) {
    throw new SourceNotPermitted(key, use, "no such source is registered");
  }
  if (source.licence === undefined) {
    throw new SourceNotPermitted(
      key,
      use,
      source.unlicensedReason ?? "no licence is recorded for it",
    );
  }
  if (!source.licence.permits.includes(use)) {
    throw new SourceNotPermitted(
      key,
      use,
      `its licence (${source.licence.name}) permits only ${source.licence.permits.join(", ")}`,
    );
  }
  return source;
}

/** True where the source may be used this way. For rendering, not for gating. */
export function sourcePermits(key: string, use: PermittedUse): boolean {
  try {
    assertSourceUsable(key, use);
    return true;
  } catch {
    return false;
  }
}

/**
 * Provenance carried by every record derived from a source.
 *
 * Attached to the data rather than logged beside it, because the question that
 * matters later — "may we show this figure to an investor?" — is a question
 * about a specific number, not about an import job.
 */
export interface SourceAttribution {
  readonly sourceKey: string;
  /** When the underlying record was published or last refreshed. */
  readonly asOf: string;
  /** Licence attribution text to render wherever this appears. */
  readonly attribution?: string;
}

export function attribute(key: string, asOf: string): SourceAttribution {
  const source = getSource(key);
  return {
    sourceKey: key,
    asOf,
    ...(source?.licence?.attribution !== undefined
      ? { attribution: source.licence.attribution }
      : {}),
  };
}

/**
 * The attribution lines to print wherever derived data is displayed.
 *
 * Deduplicated: one line per licence, not one per record.
 */
export function attributionLines(records: readonly SourceAttribution[]): readonly string[] {
  const lines = new Set<string>();
  for (const r of records) {
    if (r.attribution !== undefined) lines.add(r.attribution);
  }
  return [...lines].sort();
}

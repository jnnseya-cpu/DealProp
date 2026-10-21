/**
 * Motivated-seller signals: the strategy filters, and the honest truth about
 * which ones this platform can actually produce.
 *
 * Tools like Dryv, PropertyData and LandInsight show a panel of these —
 * "back and reduced", "probate", "repossessed", "no chain", "withdrawn in
 * last 30 days", "sold STC for 70+ days". They are genuinely useful and this
 * register names all of them, because a filter the product does not even
 * acknowledge is a worse answer than one it acknowledges and cannot yet run.
 *
 * But those tools run on licensed portal listing data. "Back and reduced",
 * "withdrawn", "sold STC" and "cash only" are facts about a Rightmove or
 * Zoopla *listing and its history*, and reading that requires a commercial
 * data agreement with the portal or a licensed reseller — not a scraper. This
 * platform does not hold that feed and will not scrape it (`portal-listings`
 * is refused in the source registry, `copy-listings` is a §20 prohibition).
 *
 * So every signal here carries its honest status:
 *
 *  - `computable`        — derivable today from data we are licensed for:
 *                          Price Paid Data, the EPC register, Companies House.
 *  - `needs-portal-feed` — a fact about a live listing. Refused until a
 *                          licensed portal feed exists, same position as
 *                          `portal-listings`.
 *  - `needs-title`       — needs the HM Land Registry title for one property,
 *                          bought per title, as `lookupOwner()` already does.
 *  - `from-seller`       — a fact only the seller knows, given on the enquiry
 *                          form by consent. Never inferred, never scraped.
 *
 * The point of the register is that the gap is visible and priced: the roughly
 * half of these signals marked `computable` work now, and the rest name
 * exactly what would unlock them, which is a contract rather than a crawl.
 */

export type SignalAvailability =
  | "computable"
  | "needs-portal-feed"
  | "needs-title"
  | "from-seller";

export type SignalKey =
  | "prepared-but-unsold"
  | "long-term-empty"
  | "corporate-owner-distress"
  | "bought-and-flipped"
  | "negative-equity"
  | "needs-work"
  | "hmo-potential"
  | "probate"
  | "repossessed"
  | "no-chain"
  | "currently-tenanted"
  | "back-and-reduced"
  | "withdrawn-recently"
  | "sold-stc-stalled"
  | "cash-only";

export interface SourcingSignal {
  readonly key: SignalKey;
  /** The label, close to the sourcing-tool vocabulary a user expects. */
  readonly label: string;
  /** What it means, in one line. */
  readonly meaning: string;
  readonly availability: SignalAvailability;
  /**
   * How it is produced, or what would have to exist first. Never "we scrape
   * it" — a `needs-portal-feed` signal names the licence, not a workaround.
   */
  readonly source: string;
}

export const SOURCING_SIGNALS: readonly SourcingSignal[] = [
  {
    key: "prepared-but-unsold",
    label: "Prepared for sale, never sold",
    meaning:
      "An EPC was lodged — the legal precondition of marketing — months ago and no sale has been registered since. The open-data equivalent of 'withdrawn' and 'off market', and the one no portal publishes.",
    availability: "computable",
    source: "EPC register joined to Price Paid Data. Built: findCandidates().",
  },
  {
    key: "long-term-empty",
    label: "Long-term empty",
    meaning:
      "Recorded by the billing authority as empty beyond the point at which an empty-homes premium bites — a holding cost with a date on it.",
    availability: "computable",
    source: "Local authority empty-homes data, carried on the registry signal.",
  },
  {
    key: "corporate-owner-distress",
    label: "Corporate owner in distress",
    meaning:
      "The registered proprietor is a company in liquidation, administration or dissolution, which forces a disposal.",
    availability: "computable",
    source:
      "Corporate ownership data joined to Companies House status. Both licensed; built on the registry signal.",
  },
  {
    key: "bought-and-flipped",
    label: "Bought and flipped",
    meaning:
      "Two arm's-length sales close together with a price jump between them — a refurbishment someone else already did, which tells you the street's finished value.",
    availability: "computable",
    source: "Price Paid Data: two category-A sales within the flip window. Built: findFlips().",
  },
  {
    key: "negative-equity",
    label: "Negative equity",
    meaning:
      "The last paid price is above a current estimate of value, so the owner may owe more than it is worth — which is where a lease option or assisted sale is the only route that works.",
    availability: "computable",
    source: "Price Paid Data last sale against an estimated current value.",
  },
  {
    key: "needs-work",
    label: "Needs work (BRRR potential)",
    meaning:
      "A poor energy rating and an old construction age band, which together predict a property a mortgage lender will decline and a refurbishment will transform.",
    availability: "computable",
    source: "EPC register: rating of E or worse plus a pre-war age band. A proxy, not a survey.",
  },
  {
    key: "hmo-potential",
    label: "Potential HMO conversion",
    meaning:
      "A large house in an area where houses in multiple occupation let well — a candidate for conversion rather than resale.",
    availability: "computable",
    source: "Price Paid Data type and size, with EPC floor area. A proxy; licensing is a separate check.",
  },
  {
    key: "probate",
    label: "Probate",
    meaning: "The property is being sold by an estate. A strong motivation and a specific legal route.",
    availability: "from-seller",
    source:
      "Given by the seller on the enquiry form, by consent. Not inferred from open data, and portal 'probate' tags need the portal feed below.",
  },
  {
    key: "repossessed",
    label: "Repossessed",
    meaning: "A lender is selling under possession, which forces both price and pace.",
    availability: "needs-portal-feed",
    source:
      "A listing or court-list fact. Price Paid flags some repossession-type transfers as category B, but only after the sale, which is too late to source on.",
  },
  {
    key: "no-chain",
    label: "No chain",
    meaning: "Nothing above the seller to collapse the sale. The single biggest driver of completion certainty.",
    availability: "needs-portal-feed",
    source:
      "A listing attribute. Approximated by prepared-but-unsold and probate, both of which usually mean no chain.",
  },
  {
    key: "currently-tenanted",
    label: "Currently tenanted",
    meaning: "Sold with a tenant in place — an investment disposal, often a landlord exiting.",
    availability: "needs-portal-feed",
    source: "A listing attribute. The landlord-exit situation is also captured from the seller directly.",
  },
  {
    key: "back-and-reduced",
    label: "Back on and reduced",
    meaning: "Relisted after coming off the market, and now cheaper — a seller whose first plan failed.",
    availability: "needs-portal-feed",
    source: "Portal listing history. Requires a licensed feed; there is no open-data equivalent of a reduction.",
  },
  {
    key: "withdrawn-recently",
    label: "Withdrawn in last 30 days",
    meaning: "Taken off the market recently — a seller who has just given up on the open market.",
    availability: "needs-portal-feed",
    source:
      "Portal listing history. The open-data proxy is prepared-but-unsold, which catches the same seller later and lawfully.",
  },
  {
    key: "sold-stc-stalled",
    label: "Sold STC, stalled",
    meaning: "Agreed a sale that has sat unresolved for months — a transaction likely to fall through.",
    availability: "needs-portal-feed",
    source: "Portal listing history. No open-data equivalent until a sale either completes or is relisted.",
  },
  {
    key: "cash-only",
    label: "Cash buyers only",
    meaning: "Marketed as unmortgageable — short lease, non-standard construction, or no working kitchen.",
    availability: "needs-portal-feed",
    source:
      "A listing attribute. A poor EPC is a weak proxy for unmortgageable but does not carry the 'cash only' instruction itself.",
  },
];

export function sourcingSignal(key: SignalKey): SourcingSignal {
  const found = SOURCING_SIGNALS.find((s) => s.key === key);
  if (found === undefined) throw new Error(`No sourcing signal recorded for "${key}".`);
  return found;
}

/** The signals that run today, on data we hold a licence for. */
export function computableSignals(): readonly SourcingSignal[] {
  return SOURCING_SIGNALS.filter((s) => s.availability === "computable");
}

/**
 * The signals that are refused, and why, grouped the way the source registry
 * groups its refusals: the gap is a licence or a conversation, never a crawl.
 */
export function blockedSignals(): readonly SourcingSignal[] {
  return SOURCING_SIGNALS.filter((s) => s.availability !== "computable");
}

export interface SignalCoverage {
  readonly total: number;
  readonly computable: number;
  readonly needsPortalFeed: number;
  readonly fromSeller: number;
  readonly needsTitle: number;
  /** One honest sentence for a page to show. */
  readonly summary: string;
}

export function signalCoverage(): SignalCoverage {
  const by = (a: SignalAvailability): number =>
    SOURCING_SIGNALS.filter((s) => s.availability === a).length;
  const computable = by("computable");
  const needsPortalFeed = by("needs-portal-feed");
  return {
    total: SOURCING_SIGNALS.length,
    computable,
    needsPortalFeed,
    fromSeller: by("from-seller"),
    needsTitle: by("needs-title"),
    summary: `${computable} of ${SOURCING_SIGNALS.length} strategy filters run on data we are licensed for today. ${needsPortalFeed} need a licensed portal feed — a commercial agreement, not a scraper — and are refused until one exists.`,
  };
}

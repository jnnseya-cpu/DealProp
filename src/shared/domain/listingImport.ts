import type { InventoryCategory, ConfirmedBy } from "@shared/domain/inventory";

/**
 * Importing a listing from a link, lawfully.
 *
 * The ask is a one-click import: a seller, an instructed agent or an auctioneer
 * pastes a link to a property already published elsewhere, and its details come
 * across. The lawful version of that is narrower than the naive one, and the
 * difference is the whole point:
 *
 *  - It is the RIGHTS-HOLDER submitting their own property, not us copying a
 *    stranger's listing. The submitter states which they are and warrants they
 *    may publish it, and that warranty is recorded against the record.
 *  - We take FACTS, never the photographs or the marketing prose. The address,
 *    the price, the type and the size are facts and are not copyrightable. The
 *    photographs belong to whoever took them and the description to whoever
 *    wrote it, and taking those is the §20 prohibition — the thing that turns a
 *    portal from an indifferent third party into a litigant.
 *  - We do NOT fetch the portals. Rightmove, Zoopla and the rest forbid
 *    automated collection in their terms, so a portal link is refused for
 *    import and the submitter enters the details instead. What we read is a
 *    publisher's OWN page — an auction house's lot, an agent's own site — and
 *    specifically the structured data it published for machines to read.
 *
 * This module is the pure half: classifying a link, mapping a page's structured
 * data to facts, and recording who stands behind the listing. The fetch, which
 * is where a licence and robots.txt are enforced, is in the backend.
 */

export type SubmitterRole = "seller" | "instructed-agent" | "auctioneer";

export type ImportKind = "importable" | "portal-refused" | "unsupported";

export interface UrlClassification {
  readonly kind: ImportKind;
  readonly host?: string;
  readonly reason: string;
}

/**
 * Portals whose terms forbid automated collection. A link to one of these is
 * refused for import — the submitter can still enter the details by hand.
 */
const PORTAL_HOSTS = [
  "rightmove.co.uk",
  "zoopla.co.uk",
  "onthemarket.com",
  "primelocation.com",
  "gumtree.com",
  "openrent.co.uk",
  "boomin.com",
];

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function isPublicHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  // No bare IPs, no IPv6 literals: a server-side fetch of a user-supplied URL
  // must not be pointed at an address rather than a published site.
  if (IPV4.test(h) || h.includes(":")) return false;
  // Must be a real registrable domain, not a single internal label.
  if (!h.includes(".")) return false;
  if (/(^|\.)(localhost|local|internal|lan|home|test|invalid|example)$/.test(h)) return false;
  return true;
}

function registrable(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, "").split(".");
  // Enough to recognise a portal behind www. and a country second-level domain.
  return parts.slice(-3).join(".");
}

export function isPortalHost(host: string): boolean {
  const h = host.toLowerCase();
  return PORTAL_HOSTS.some((p) => h === p || h.endsWith(`.${p}`) || registrable(h).endsWith(p));
}

/**
 * Decide what, if anything, may be done with a submitted link.
 *
 * Refuses before any request is made: an insecure link, a non-public host, or a
 * portal all stop here, so a refused link never generates traffic.
 */
export function classifyImportUrl(raw: string): UrlClassification {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { kind: "unsupported", reason: "That is not a valid web address." };
  }
  if (url.protocol !== "https:") {
    return { kind: "unsupported", reason: "Only secure (https) links can be imported." };
  }
  if (url.username !== "" || url.password !== "") {
    return { kind: "unsupported", reason: "A link that carries a login cannot be imported." };
  }
  const host = url.hostname.toLowerCase();
  if (!isPublicHost(host)) {
    return { kind: "unsupported", reason: "That link does not point to a public website." };
  }
  if (isPortalHost(host)) {
    return {
      kind: "portal-refused",
      host,
      reason:
        "That is a property portal, and its terms do not permit automated import. Enter the details by hand instead — you can still publish the property here.",
    };
  }
  return {
    kind: "importable",
    host,
    reason: "The publisher's own page can be read for its structured details.",
  };
}

/* -------------------------------------------------------- the facts */

/**
 * The facts taken from a listing. Never the photographs or the description.
 *
 * `priceGbp` is the asking or guide price AS LISTED — a claim by the seller or
 * their agent, not an independent valuation. The platform's own appraisal runs
 * separately, and a listing does not go live on the strength of its own asking
 * price, because repeating an asking price is exactly what a portal does.
 */
export interface ImportedListing {
  readonly sourceUrl: string;
  readonly publisherHost: string;
  /** The listing's own title or name — a short fact, not the description. */
  readonly title?: string;
  readonly address?: string;
  readonly postcode?: string;
  /** Asking or guide price in whole pounds, as listed. A claim, not a valuation. */
  readonly priceGbp?: number;
  /** "guide price", "asking price", "offers over" — as the page qualified it. */
  readonly priceQualifier?: string;
  readonly propertyType?: string;
  readonly bedrooms?: number;
  readonly bathrooms?: number;
  readonly tenure?: string;
  readonly floorAreaSqm?: number;
  /** For an auction lot: the sale date and the lot number, where stated. */
  readonly auctionDate?: string;
  readonly lotNumber?: string;
}

const LISTING_TYPES = [
  "product",
  "offer",
  "realestatelisting",
  "residence",
  "singlefamilyresidence",
  "house",
  "apartment",
  "accommodation",
  "place",
];

/** True where a JSON-LD node looks like a property listing. */
export function isListingNode(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  const type = (node as Record<string, unknown>)["@type"];
  const types = (Array.isArray(type) ? type : [type]).map((t) => String(t).toLowerCase());
  return types.some((t) => LISTING_TYPES.includes(t));
}

function str(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[£,\s]/g, ""));
    return Number.isFinite(n) && n !== 0 ? n : undefined;
  }
  return undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) return asObject(value[0]);
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

/**
 * Map one structured-data node to facts. No inference: a field appears only
 * where the page stated it, and nothing is constructed from parts.
 */
export function mapListingJsonLd(node: Record<string, unknown>): Partial<ImportedListing> {
  const out: { -readonly [K in keyof ImportedListing]?: ImportedListing[K] } = {};
  const title = str(node["name"]) ?? str(node["headline"]);
  if (title !== undefined) out.title = title;

  const address = asObject(node["address"]);
  if (address !== undefined) {
    const line = [str(address["streetAddress"]), str(address["addressLocality"]), str(address["addressRegion"])]
      .filter((p) => p !== undefined)
      .join(", ");
    if (line !== "") out.address = line;
    const postcode = str(address["postalCode"]);
    if (postcode !== undefined) out.postcode = postcode.toUpperCase();
  } else {
    const flat = str(node["address"]);
    if (flat !== undefined) out.address = flat;
  }

  const offer = asObject(node["offers"]) ?? asObject(node["priceSpecification"]);
  const price = num(offer?.["price"]) ?? num(node["price"]);
  if (price !== undefined) out.priceGbp = Math.round(price);

  const beds = num(node["numberOfBedrooms"]) ?? num(node["numberOfRooms"]);
  if (beds !== undefined) out.bedrooms = Math.round(beds);
  const baths = num(node["numberOfBathroomsTotal"]) ?? num(node["numberOfBathrooms"]);
  if (baths !== undefined) out.bathrooms = Math.round(baths);

  const floor = asObject(node["floorSize"]);
  const area = num(floor?.["value"]) ?? num(node["floorSize"]);
  if (area !== undefined) out.floorAreaSqm = Math.round(area);

  return out;
}

/* ------------------------------------------------------ who stands behind it */

/**
 * Map the submitter's role to the inventory category and who confirmed it.
 *
 * A seller submitting their own property is owner-verified. An instructed agent
 * or an auctioneer acting on the owner's instruction is agent-authorised — the
 * category that says a professional with authority stands behind it, short of
 * the owner confirming it directly. Neither is "ai-discovered": a person
 * submitted this.
 */
export function roleToInventory(role: SubmitterRole): {
  readonly category: InventoryCategory;
  readonly confirmedBy: ConfirmedBy;
} {
  if (role === "seller") return { category: "owner-verified", confirmedBy: "owner" };
  return { category: "agent-authorised", confirmedBy: "instructed-agent" };
}

export const SUBMITTER_ROLES: readonly { readonly value: SubmitterRole; readonly label: string }[] = [
  { value: "seller", label: "I own this property" },
  { value: "instructed-agent", label: "I am the instructed estate agent" },
  { value: "auctioneer", label: "I am the auctioneer" },
];

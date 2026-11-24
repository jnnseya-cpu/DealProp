/**
 * Contracts Finder → land & property disposal opportunities.
 *
 * Contracts Finder (OGL) carries every public-sector notice, the great majority
 * of which are the authority BUYING services — not what we want. A minority are
 * councils and public bodies SELLING: land for sale, freehold disposals,
 * development opportunities. This module is the honest filter that tells the two
 * apart, so the feed never shows a bin-collection contract as a development site.
 *
 * It is pure: it classifies and maps an OCDS release to a LandDisposal, and
 * carries WHY it matched (decision #6). The backend connector does the fetch.
 * Personal contact details in a notice are never surfaced here — only the public
 * notice facts and a link; any approach goes through the outreach spine's lawful
 * -basis checks, never from this module.
 */

export const DISPOSALS_VERSION = "disposals-1";

/** A loosely-typed OCDS release as Contracts Finder returns it. */
export interface OcdsRelease {
  readonly ocid?: string;
  readonly id?: string;
  readonly date?: string;
  readonly tender?: {
    readonly id?: string;
    readonly title?: string;
    readonly description?: string;
    readonly value?: { readonly amount?: number; readonly currency?: string };
    readonly tenderPeriod?: { readonly endDate?: string; readonly startDate?: string };
    readonly classification?: { readonly scheme?: string; readonly id?: string; readonly description?: string };
    readonly additionalClassifications?: ReadonlyArray<{ readonly id?: string; readonly description?: string }>;
    readonly items?: ReadonlyArray<{
      readonly deliveryAddresses?: ReadonlyArray<{ readonly region?: string; readonly postalCode?: string }>;
    }>;
    readonly documents?: ReadonlyArray<{ readonly documentType?: string; readonly url?: string }>;
  };
  readonly buyer?: { readonly name?: string; readonly id?: string };
  readonly [key: string]: unknown;
}

export interface LandDisposal {
  readonly id: string;
  readonly title: string;
  readonly authority: string;
  readonly description: string;
  readonly region?: string;
  readonly postcode?: string;
  /** Guide value where the notice states one in sterling. */
  readonly valueGbp?: number;
  readonly published?: string;
  readonly deadline?: string;
  readonly url: string;
  readonly cpvCodes: readonly string[];
  /** Why this was accepted as a land/property disposal (provenance). */
  readonly matchedOn: readonly string[];
}

/**
 * CPV codes for the sale/purchase of land and buildings (70122xxx), the
 * strongest structured signal that a notice concerns real property rather than
 * a service. The broader 70-series (estate-agency services) is NOT enough on its
 * own — a council buying managing-agent services also carries it — so it only
 * counts alongside a disposal keyword.
 */
function cpvCodesOf(release: OcdsRelease): string[] {
  const codes: string[] = [];
  const main = release.tender?.classification?.id;
  if (typeof main === "string" && main.trim() !== "") codes.push(main.trim());
  for (const c of release.tender?.additionalClassifications ?? []) {
    if (typeof c.id === "string" && c.id.trim() !== "") codes.push(c.id.trim());
  }
  return codes;
}

const DISPOSAL_KEYWORDS =
  /\b(disposal|dispose|for sale|freehold|long lease|ground lease|surplus (?:land|property|site)|sale of (?:land|site|the freehold|property)|development opportunity|redevelopment opportunity|land for development)\b/i;

const REAL_ESTATE_CPV_PREFIX = "70"; // estate-agency / real-estate services
const SALE_OF_PROPERTY_CPV_PREFIX = "70122"; // sale or purchase of land/buildings

export interface DisposalMatch {
  readonly isDisposal: boolean;
  readonly matchedOn: readonly string[];
}

/**
 * Decide whether a notice is a genuine land/property DISPOSAL opportunity, and
 * record why. A sale-of-property CPV (70122…) is decisive on its own; the
 * broad real-estate CPV (70…) counts only with a disposal keyword; a disposal
 * keyword in the text counts on its own. Anything else is not a disposal — the
 * default is exclusion, not inclusion.
 */
export function classifyDisposal(release: OcdsRelease): DisposalMatch {
  const codes = cpvCodesOf(release);
  const text = `${release.tender?.title ?? ""} ${release.tender?.description ?? ""}`;
  const matchedOn: string[] = [];

  const saleCpv = codes.find((c) => c.startsWith(SALE_OF_PROPERTY_CPV_PREFIX));
  if (saleCpv !== undefined) matchedOn.push(`CPV ${saleCpv} (sale/purchase of land or buildings)`);

  const keyword = DISPOSAL_KEYWORDS.exec(text);
  if (keyword !== null) matchedOn.push(`keyword "${keyword[0].toLowerCase()}"`);

  const realEstateCpv = codes.find((c) => c.startsWith(REAL_ESTATE_CPV_PREFIX));
  if (realEstateCpv !== undefined && keyword !== null && saleCpv === undefined) {
    matchedOn.push(`CPV ${realEstateCpv} (real estate) with a disposal keyword`);
  }

  // Decisive on its own: a sale CPV, or a disposal keyword. A bare real-estate
  // CPV with no keyword is not enough (it is often a services procurement).
  const isDisposal = saleCpv !== undefined || keyword !== null;
  return { isDisposal, matchedOn };
}

function firstAddress(release: OcdsRelease): { region?: string; postalCode?: string } {
  for (const item of release.tender?.items ?? []) {
    for (const a of item.deliveryAddresses ?? []) {
      if (a.region !== undefined || a.postalCode !== undefined) return a;
    }
  }
  return {};
}

const NOTICE_BASE = "https://www.contractsfinder.service.gov.uk/Notice/";

/** The canonical Contracts Finder notice URL from the release's documents. */
function noticeUrl(release: OcdsRelease, id: string): string {
  for (const doc of release.tender?.documents ?? []) {
    if (typeof doc.url === "string" && doc.url.includes("contractsfinder.service.gov.uk/Notice/")) {
      return doc.url;
    }
  }
  return `${NOTICE_BASE}${encodeURIComponent(id)}`;
}

/**
 * Map a release to a LandDisposal, or undefined when it is not a disposal or
 * lacks the minimum (an id and a title). The value is carried only when the
 * notice states it in sterling — a foreign or absent amount is left unset
 * rather than shown as £0.
 */
export function mapDisposalRelease(release: OcdsRelease): LandDisposal | undefined {
  const id = typeof release.id === "string" && release.id.trim() !== ""
    ? release.id.trim()
    : typeof release.ocid === "string" && release.ocid.trim() !== ""
      ? release.ocid.trim()
      : undefined;
  const title = release.tender?.title;
  if (id === undefined || typeof title !== "string" || title.trim() === "") return undefined;

  const match = classifyDisposal(release);
  if (!match.isDisposal) return undefined;

  const addr = firstAddress(release);
  const value = release.tender?.value;
  const valueGbp = value !== undefined && (value.currency ?? "GBP") === "GBP" && typeof value.amount === "number" && value.amount > 0
    ? value.amount
    : undefined;

  return {
    id,
    title: title.trim(),
    authority: typeof release.buyer?.name === "string" && release.buyer.name.trim() !== "" ? release.buyer.name.trim() : "a public authority",
    description: typeof release.tender?.description === "string" ? release.tender.description.trim().slice(0, 600) : "",
    ...(addr.region !== undefined && addr.region !== "" ? { region: addr.region } : {}),
    ...(addr.postalCode !== undefined && addr.postalCode !== "" ? { postcode: addr.postalCode } : {}),
    ...(valueGbp !== undefined ? { valueGbp } : {}),
    ...(typeof release.date === "string" && release.date !== "" ? { published: release.date } : {}),
    ...(typeof release.tender?.tenderPeriod?.endDate === "string" && release.tender.tenderPeriod.endDate !== ""
      ? { deadline: release.tender.tenderPeriod.endDate }
      : {}),
    url: noticeUrl(release, id),
    cpvCodes: cpvCodesOf(release),
    matchedOn: match.matchedOn,
  };
}

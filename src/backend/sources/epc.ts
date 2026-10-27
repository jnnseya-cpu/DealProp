import { assertSourceUsable, attribute, type SourceAttribution } from "@shared/domain/sources";
import type { EpcRating } from "@shared/domain/jurisdictions/types";

/**
 * Energy Performance of Buildings Register.
 *
 * Free, licensed, and the single most useful open dataset for this product,
 * for three reasons that have nothing to do with energy:
 *
 *  1. **Floor area.** Every certificate carries it. Bedroom count — the thing
 *     portals index on — is close to useless for comparison, because a
 *     three-bed terrace can be 70sqm or 110sqm and the difference is the whole
 *     margin. £/sqm is the number a surveyor actually uses.
 *  2. **Lodgement date.** An EPC is a legal precondition of marketing a
 *     property. One lodged with no sale following is a sale that was prepared
 *     and did not happen, which is precisely the "why unsold?" signal GoldMine
 *     wanted from portal relist counts.
 *  3. **The rating itself.** Below the letting standard, the owner must spend
 *     or stop letting — a decision with a statutory deadline behind it.
 *
 * Access requires a free account; the API key is a basic-auth credential and
 * must come from the environment, never the repository.
 *
 * This is a second outbound path, separate from the discovery `Fetcher`. That
 * one crawls unauthenticated public pages and so consults robots.txt; this is
 * an authenticated call to a licensed API we hold a key for, where robots.txt
 * does not apply and crawl rate-limiting is not the right control for a single
 * per-postcode lookup. The controls that DO apply are enforced below: the
 * licence gate, the credential, a bounded timeout, and a refusal to follow a
 * redirect that could carry the credential off the licensed host.
 *
 * NOTE ON VERIFICATION: parsing is covered by fixture tests built from the
 * published field list, but no live request has been made from this
 * environment — outbound access is blocked here. Verify `fetchCertificates()`
 * against the real endpoint before relying on it.
 */

const SOURCE = "epc-register";
/**
 * The default search endpoint, as of the 2026 migration. The legacy
 * `epc.opendatacommunities.org/api/v1/domestic/search` was retired and now
 * 301-redirects; the service lives at the `api.` subdomain below and is
 * verified reachable from production. `EPC_API_BASE` overrides the full endpoint
 * URL so a future move is a configuration change, not a redeploy, and because
 * this request carries a credential the redirect is refused (see `redirect:
 * "error"` below) rather than followed to a host we did not licence.
 */
const DEFAULT_API = "https://api.get-energy-performance-data.communities.gov.uk/api/domestic/search";
/** How long a single EPC lookup may take before it is abandoned. */
const TIMEOUT_MS = 15_000;

const RATINGS = new Set(["A", "B", "C", "D", "E", "F", "G"]);

export interface EpcCertificate {
  readonly lmkKey: string;
  readonly address: string;
  /**
   * The first address line on its own ("14 Acacia Avenue"), without the town.
   * The combined `address` carries the locality too, which would never match
   * Price Paid's street; this is what the address key is built from.
   */
  readonly addressLine1: string;
  readonly postcode: string;
  readonly rating?: EpcRating;
  /** Rating the assessor says is achievable after improvements. */
  readonly potentialRating?: EpcRating;
  /** ISO-8601 date the certificate was lodged. */
  readonly lodgedAt: string;
  readonly floorAreaSqm?: number;
  /** e.g. "House", "Bungalow", "Flat". */
  readonly propertyType?: string;
  /** e.g. "1900-1929". Useful because pre-1930 stock is where the works are. */
  readonly constructionAgeBand?: string;
  readonly tenure?: string;
  readonly source: SourceAttribution;
}

/** The subset of the LEGACY EPC API fields this adapter reads. All strings. */
interface EpcRow {
  readonly "lmk-key"?: string;
  readonly address?: string;
  readonly address1?: string;
  readonly address2?: string;
  readonly postcode?: string;
  readonly "current-energy-rating"?: string;
  readonly "potential-energy-rating"?: string;
  readonly "lodgement-date"?: string;
  readonly "inspection-date"?: string;
  readonly "total-floor-area"?: string;
  readonly "property-type"?: string;
  readonly "construction-age-band"?: string;
  readonly tenure?: string;
}

/**
 * One row from the 2026 service's `data` array. The search result is a summary —
 * it carries the address, postcode, band and registration date, but NOT the
 * floor area or property type (those need the full certificate, a separate
 * call). The fields that are present are enough for the prepared-but-unsold
 * signal, which turns on a certificate existing with no sale registered since;
 * floor area and type are tolerated here where present and left undefined
 * otherwise, which the join already handles.
 */
interface EpcDataRow {
  readonly certificateNumber?: string;
  readonly addressLine1?: string;
  readonly addressLine2?: string;
  readonly addressLine3?: string;
  readonly addressLine4?: string;
  readonly postcode?: string;
  readonly postTown?: string;
  readonly currentEnergyEfficiencyBand?: string;
  readonly registrationDate?: string;
  readonly propertyType?: string;
  readonly totalFloorArea?: string | number;
  readonly tenure?: string;
}

function rating(raw: string | undefined): EpcRating | undefined {
  const value = (raw ?? "").trim().toUpperCase();
  return RATINGS.has(value) ? (value as EpcRating) : undefined;
}

function floorArea(raw: string | undefined): number | undefined {
  const value = Number(raw);
  // Certificates carry occasional zeroes and absurd values where the assessor
  // mis-keyed. A 5sqm or 5,000sqm dwelling is a data error, and letting either
  // through produces a £/sqm figure that silently rubbishes a comparison.
  if (!Number.isFinite(value) || value < 15 || value > 2_000) return undefined;
  return Math.round(value);
}

export function parseCertificates(body: unknown): readonly EpcCertificate[] {
  const b = (body ?? {}) as { rows?: readonly EpcRow[]; data?: readonly EpcDataRow[] };
  // The 2026 service returns { data: [...] }; the legacy one returned
  // { rows: [...] }. Detect by shape so both parse, and a response that is
  // neither yields nothing rather than throwing.
  if (Array.isArray(b.data)) {
    return b.data
      .map(fromDataRow)
      .filter((c): c is EpcCertificate => c !== undefined);
  }
  return (b.rows ?? [])
    .map(fromLegacyRow)
    .filter((c): c is EpcCertificate => c !== undefined);
}

/** A certificate from the 2026 service's `data` row. */
function fromDataRow(row: EpcDataRow): EpcCertificate | undefined {
  const lodged = (row.registrationDate ?? "").slice(0, 10);
  if (lodged === "") return undefined;

  const addressLine1 = (row.addressLine1 ?? "").trim();
  const address = [row.addressLine1, row.addressLine2, row.addressLine3, row.addressLine4, row.postTown]
    .filter((p) => p !== undefined && p !== "")
    .join(", ")
    .trim();
  const areaRaw = typeof row.totalFloorArea === "number" ? String(row.totalFloorArea) : row.totalFloorArea;

  return {
    lmkKey: row.certificateNumber ?? "",
    address: address !== "" ? address : addressLine1,
    addressLine1: addressLine1 !== "" ? addressLine1 : address,
    // The service returns the postcode with a '+' for the space (M20+4AP).
    postcode: (row.postcode ?? "").toUpperCase().replace(/\+/g, " ").trim(),
    ...(rating(row.currentEnergyEfficiencyBand) !== undefined
      ? { rating: rating(row.currentEnergyEfficiencyBand) }
      : {}),
    lodgedAt: lodged,
    ...(floorArea(areaRaw) !== undefined ? { floorAreaSqm: floorArea(areaRaw) } : {}),
    ...(row.propertyType !== undefined ? { propertyType: row.propertyType } : {}),
    ...(row.tenure !== undefined ? { tenure: row.tenure } : {}),
    source: attribute(SOURCE, lodged),
  };
}

/** A certificate from a legacy `rows` entry. */
function fromLegacyRow(row: EpcRow): EpcCertificate | undefined {
  // Lodgement is the date the certificate entered the register; inspection is
  // when the assessor attended. Either dates the "somebody prepared to sell"
  // signal, so the earlier one is used where both exist.
  const lodged = (row["lodgement-date"] ?? row["inspection-date"] ?? "").slice(0, 10);
  if (lodged === "") return undefined;

  const addressLine1 = (row.address1 ?? "").trim();
  const address =
    row.address ??
    [row.address1, row.address2].filter((p) => p !== undefined && p !== "").join(", ");

  return {
    lmkKey: row["lmk-key"] ?? "",
    address: address.trim(),
    addressLine1: addressLine1 !== "" ? addressLine1 : address.trim(),
    postcode: (row.postcode ?? "").toUpperCase(),
    ...(rating(row["current-energy-rating"]) !== undefined
      ? { rating: rating(row["current-energy-rating"]) }
      : {}),
    ...(rating(row["potential-energy-rating"]) !== undefined
      ? { potentialRating: rating(row["potential-energy-rating"]) }
      : {}),
    lodgedAt: lodged,
    ...(floorArea(row["total-floor-area"]) !== undefined
      ? { floorAreaSqm: floorArea(row["total-floor-area"]) }
      : {}),
    ...(row["property-type"] !== undefined ? { propertyType: row["property-type"] } : {}),
    ...(row["construction-age-band"] !== undefined
      ? { constructionAgeBand: row["construction-age-band"] }
      : {}),
    ...(row.tenure !== undefined ? { tenure: row.tenure } : {}),
    source: attribute(SOURCE, lodged),
  };
}

/** The current certificate for an address: the most recently lodged one. */
export function currentCertificate(
  certificates: readonly EpcCertificate[],
): EpcCertificate | undefined {
  return [...certificates].sort((a, b) => b.lodgedAt.localeCompare(a.lodgedAt))[0];
}

/**
 * Fetch certificates for a postcode.
 *
 * The key is read from the environment at call time rather than at import, so a
 * process that never queries EPC does not require the credential to exist.
 */
export async function fetchCertificates(
  postcode: string,
  { size = 100, fetchImpl = fetch }: { size?: number; fetchImpl?: typeof fetch } = {},
): Promise<readonly EpcCertificate[]> {
  assertSourceUsable(SOURCE, "internal-analysis");

  // Two auth schemes across the migration. The 2026 service issues a Bearer
  // token ("Bearer token (for developers)", shown in the footer when signed in);
  // the legacy opendatacommunities host used Basic email:key. Prefer the token
  // where set, fall back to Basic for the legacy host, and fail closed if
  // neither is configured — an unconfigured import must refuse rather than
  // quietly return nothing and let a caller conclude the property has no
  // certificate.
  const token = process.env.EPC_API_TOKEN;
  const email = process.env.EPC_API_EMAIL;
  const key = process.env.EPC_API_KEY;
  let authorization: string;
  if (token !== undefined && token !== "") {
    authorization = `Bearer ${token}`;
  } else if (email !== undefined && email !== "" && key !== undefined && key !== "") {
    authorization = `Basic ${Buffer.from(`${email}:${key}`).toString("base64")}`;
  } else {
    throw new Error(
      "EPC auth is not configured; set EPC_API_TOKEN (new service) or EPC_API_EMAIL and EPC_API_KEY (legacy). Refusing to query.",
    );
  }

  const url = new URL(process.env.EPC_API_BASE ?? DEFAULT_API);
  url.searchParams.set("postcode", postcode.toUpperCase());
  // The 2026 service paginates with `page_size`; the legacy one used `size`.
  // Both are sent so either endpoint honours the bound and ignores the other.
  url.searchParams.set("page_size", String(size));
  url.searchParams.set("size", String(size));

  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      authorization,
    },
    // Bounded, and never follow a redirect: this request carries a Basic-auth
    // credential, and a redirect to another host would hand it to somewhere we
    // did not licence. `redirect: "error"` is this path's equivalent of the
    // discovery Fetcher's host allowlist; the timeout is its equivalent of the
    // per-run budget.
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`EPC register returned ${response.status} for ${postcode}`);
  }
  return parseCertificates(await response.json());
}

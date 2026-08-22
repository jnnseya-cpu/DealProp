import { assertSourceUsable, attribute, type SourceAttribution } from "@/domain/sources";
import type { EpcRating } from "@/domain/jurisdictions/types";

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
 * NOTE ON VERIFICATION: parsing is covered by fixture tests built from the
 * published field list, but no live request has been made from this
 * environment — outbound access is blocked here. Verify `fetchCertificates()`
 * against the real endpoint before relying on it.
 */

const SOURCE = "epc-register";
const API = "https://epc.opendatacommunities.org/api/v1/domestic/search";

const RATINGS = new Set(["A", "B", "C", "D", "E", "F", "G"]);

export interface EpcCertificate {
  readonly lmkKey: string;
  readonly address: string;
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

/** The subset of EPC API fields this adapter reads. All arrive as strings. */
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
  const rows = (body as { rows?: readonly EpcRow[] }).rows ?? [];
  const certificates: EpcCertificate[] = [];

  for (const row of rows) {
    // Lodgement is the date the certificate entered the register; inspection is
    // when the assessor attended. Either dates the "somebody prepared to sell"
    // signal, so the earlier one is used where both exist.
    const lodged = (row["lodgement-date"] ?? row["inspection-date"] ?? "").slice(0, 10);
    if (lodged === "") continue;

    const address =
      row.address ??
      [row.address1, row.address2].filter((p) => p !== undefined && p !== "").join(", ");

    certificates.push({
      lmkKey: row["lmk-key"] ?? "",
      address: address.trim(),
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
    });
  }

  return certificates;
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

  const email = process.env.EPC_API_EMAIL;
  const key = process.env.EPC_API_KEY;
  if (email === undefined || email === "" || key === undefined || key === "") {
    // Fails closed, like every other credential in this codebase: an
    // unconfigured import must refuse rather than quietly return nothing and
    // let a caller conclude the property has no certificate.
    throw new Error("EPC_API_EMAIL and EPC_API_KEY are not configured; refusing to query.");
  }

  const url = new URL(API);
  url.searchParams.set("postcode", postcode.toUpperCase());
  url.searchParams.set("size", String(size));

  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      authorization: `Basic ${Buffer.from(`${email}:${key}`).toString("base64")}`,
    },
  });
  if (!response.ok) {
    throw new Error(`EPC register returned ${response.status} for ${postcode}`);
  }
  return parseCertificates(await response.json());
}

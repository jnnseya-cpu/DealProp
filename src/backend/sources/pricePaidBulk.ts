import { fromMajor } from "@shared/money";
import { splitRow, type PricePaidRecord } from "@backend/discovery/properties";

/**
 * The bulk HM Land Registry Price Paid loader's record and row parser.
 *
 * Why this exists, when `fetchSales()` already reads Price Paid live: the
 * Land Registry linked-data (SPARQL) endpoint is far sparser than the published
 * monthly bulk file. Many ordinary residential postcodes come back empty from
 * the endpoint even though the bulk file holds their sales, so a sourcing run
 * over a launch area saw EPC and Gazette produce signal while Price Paid
 * contributed nothing. The fix is not a cleverer query — it is loading the
 * dense file once and reading it from the store.
 *
 * This module is the pure, streaming-friendly half: a single-row parser the
 * loader script calls line by line (the whole-file `parsePricePaid` in
 * `discovery/properties.ts` holds the entire string in memory, which is fine
 * for a fixture and fatal for a multi-gigabyte file), plus the postcode-area
 * filter the loader uses to keep only the region being launched.
 *
 * It keeps the one field `parsePricePaid` drops: the transaction unique
 * identifier. That is the dedup/primary key, so a re-load — a monthly refresh —
 * upserts a changed sale rather than appending a duplicate.
 *
 * Licensed exactly as every other Price Paid read: the loader calls
 * `assertSourceUsable("land-registry-ppd", ...)` once before streaming, so the
 * per-row parser stays pure and is not asked to re-check the licence millions
 * of times.
 */

/** One registered sale as persisted in the bulk store. */
export interface PricePaidSale extends PricePaidRecord {
  /**
   * HM Land Registry transaction unique identifier — the dedup/primary key.
   * `parsePricePaid` drops it because the sourcing join does not need it; the
   * bulk store does, so a refresh updates a row instead of duplicating it.
   */
  readonly transactionId: string;
}

/**
 * Parse one line of the Price Paid CSV, or `undefined` for a line that is not a
 * storable sale.
 *
 * The published file has no header and sixteen columns in a fixed order. This
 * mirrors `parsePricePaid` field for field — same split, same validation — and
 * adds two things the bulk feed needs: it keeps column 0 (the transaction id),
 * and it honours column 15 (the record status) in the monthly-update files,
 * where `D` marks a transaction the registry has deleted. A deletion is not a
 * sale, so it is not stored; a `C` (change) parses like any row and the
 * upsert-by-transaction applies it. (Applying a `D` to remove an already-loaded
 * sale is out of scope: refresh from the complete file to drop retractions.)
 */
export function parseBulkRow(line: string): PricePaidSale | undefined {
  if (line.trim() === "") return undefined;
  const f = splitRow(line).map((v) => v.replace(/^"|"$/g, "").trim());
  // 16 columns in the published order. Anything shorter is not a row.
  if (f.length < 15) return undefined;
  // Record status D (monthly-update files only) is a deletion, not a sale.
  if (f[15] === "D") return undefined;

  const transactionId = f[0] ?? "";
  const pounds = Number(f[1]);
  const date = (f[2] ?? "").slice(0, 10);
  const category = f[14] === "B" ? "B" : f[14] === "A" ? "A" : undefined;

  if (
    transactionId === "" ||
    !Number.isFinite(pounds) ||
    pounds <= 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    category === undefined
  ) {
    return undefined;
  }

  return {
    transactionId,
    // The file publishes whole pounds; Money is integer pence everywhere, so it
    // converts once here at the edge, exactly as parsePricePaid does.
    price: fromMajor(pounds),
    soldAt: date,
    postcode: (f[3] ?? "").toUpperCase().replace(/\s+/g, " ").trim(),
    propertyType: f[4] ?? "",
    newBuild: f[5] === "Y",
    tenure: f[6] ?? "",
    paon: f[7] ?? "",
    saon: f[8] ?? "",
    street: f[9] ?? "",
    category,
  };
}

/** The alphabetic area of a postcode: "B23 5AB" → "B", "CV1 2AB" → "CV". */
export function postcodeArea(postcode: string): string {
  const match = /^([A-Z]{1,2})/.exec(postcode.toUpperCase().trim());
  return match?.[1] ?? "";
}

/**
 * Whether a postcode is in one of the configured areas. An empty area list
 * means no filter (load everything), which is what a national load wants.
 */
export function inAreas(postcode: string, areas: readonly string[]): boolean {
  if (areas.length === 0) return true;
  const area = postcodeArea(postcode);
  return areas.some((a) => a.toUpperCase() === area);
}

/**
 * The default launch region: Birmingham and the surrounding West Midlands
 * postcode areas the platform is piloting in (`supply.ts` LAUNCH_REGION).
 */
export const DEFAULT_LOAD_AREAS = ["B", "CV", "DY", "WS", "WV"] as const;

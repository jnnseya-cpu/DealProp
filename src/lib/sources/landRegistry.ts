import { fromMajor, type Money } from "@/lib/money";
import { assertSourceUsable, attribute, type SourceAttribution } from "@/domain/sources";

/**
 * HM Land Registry Price Paid Data.
 *
 * Every registered sale in England and Wales since 1995, published monthly
 * under the Open Government Licence. Free, complete, and explicitly licensed
 * for commercial reuse — which makes it the exact opposite of the portal data
 * GoldMine was blocked on.
 *
 * The transaction feed is available two ways. The bulk CSV is a single file per
 * month and is what a real import should use; the Linked Data API is convenient
 * for a handful of postcodes and is rate-limited. Both are parsed here because
 * an import that can only read one of them will be rewritten the first time
 * volume grows.
 *
 * NOTE ON VERIFICATION: the parsers below are covered by fixture tests taken
 * from the published field definitions, but no live request has been made from
 * this environment — outbound network access is blocked here. Run
 * `fetchPricePaid()` against the real endpoint before relying on it.
 */

const SOURCE = "land-registry-ppd";

/** Columns of the Price Paid Data CSV, in the published order. */
const CSV_COLUMNS = [
  "transactionId",
  "price",
  "dateOfTransfer",
  "postcode",
  "propertyType",
  "oldNew",
  "duration",
  "paon",
  "saon",
  "street",
  "locality",
  "townCity",
  "district",
  "county",
  "categoryType",
  "recordStatus",
] as const;

export interface PricePaidRecord {
  readonly transactionId: string;
  readonly price: Money;
  /** ISO-8601 date of transfer. */
  readonly date: string;
  readonly postcode: string;
  /** D detached, S semi, T terraced, F flat, O other. */
  readonly propertyType: string;
  /** F freehold, L leasehold. */
  readonly tenure: string;
  readonly address: string;
  readonly locality: string;
  /**
   * False for transfers that are not open-market sales: repossessions, buy-to-
   * let portfolios sold as one, transfers between related parties. Including
   * them in a median silently drags it down and makes every deal look worse
   * than it is.
   */
  readonly armsLength: boolean;
  readonly source: SourceAttribution;
}

/** Split a CSV line, honouring quoted fields. Price Paid Data quotes every one. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch ?? "";
    }
  }
  out.push(current);
  return out;
}

/**
 * Parse the monthly bulk CSV.
 *
 * Rows that cannot be understood are skipped rather than defaulted. A sale with
 * an unparseable price is not a sale at £0, and one bad row must not poison a
 * median that a deal is then priced against.
 */
export function parsePricePaidCsv(csv: string): readonly PricePaidRecord[] {
  const records: PricePaidRecord[] = [];

  for (const line of csv.split("\n")) {
    if (line.trim() === "") continue;
    const cells = splitCsvLine(line).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cells.length < CSV_COLUMNS.length) continue;

    const raw: Record<string, string> = {};
    CSV_COLUMNS.forEach((name, i) => {
      raw[name] = cells[i] ?? "";
    });

    const pounds = Number(raw.price);
    const date = (raw.dateOfTransfer ?? "").slice(0, 10);
    if (!Number.isFinite(pounds) || pounds <= 0 || date === "") continue;

    // Record status D means the row is a deletion of a previously published
    // transaction. Treating it as a sale double-counts and then keeps a sale
    // that the registry has since retracted.
    if (raw.recordStatus === "D") continue;

    records.push({
      transactionId: raw.transactionId ?? "",
      price: fromMajor(Math.round(pounds)),
      date,
      postcode: raw.postcode ?? "",
      propertyType: raw.propertyType ?? "",
      tenure: raw.duration ?? "",
      address: [raw.saon, raw.paon, raw.street].filter((p) => p !== "").join(" ").trim(),
      locality: raw.townCity ?? "",
      // Category B is "additional price paid": repossessions, buy-to-let
      // portfolios, transfers to a related party. Category A is a standard
      // open-market sale.
      armsLength: raw.categoryType !== "B",
      source: attribute(SOURCE, date),
    });
  }

  return records;
}

/** One transaction as the Linked Data API returns it. */
interface LinkedDataItem {
  readonly transactionId?: string;
  readonly pricePaid?: number;
  readonly transactionDate?: string;
  readonly transactionCategory?: { readonly prefLabel?: readonly string[] };
  readonly propertyAddress?: {
    readonly postcode?: string;
    readonly paon?: string;
    readonly saon?: string;
    readonly street?: string;
    readonly town?: string;
  };
  readonly propertyType?: { readonly prefLabel?: readonly string[] };
  readonly estateType?: { readonly prefLabel?: readonly string[] };
}

function firstLabel(node?: { readonly prefLabel?: readonly string[] }): string {
  return node?.prefLabel?.[0] ?? "";
}

/** Parse the Linked Data API's JSON response. */
export function parsePricePaidJson(body: unknown): readonly PricePaidRecord[] {
  const items = (body as { result?: { items?: readonly LinkedDataItem[] } }).result?.items ?? [];
  const records: PricePaidRecord[] = [];

  for (const item of items) {
    const pounds = item.pricePaid;
    const date = (item.transactionDate ?? "").slice(0, 10);
    if (typeof pounds !== "number" || pounds <= 0 || date === "") continue;

    const address = item.propertyAddress;
    records.push({
      transactionId: item.transactionId ?? "",
      price: fromMajor(Math.round(pounds)),
      date,
      postcode: address?.postcode ?? "",
      propertyType: firstLabel(item.propertyType),
      tenure: firstLabel(item.estateType),
      address: [address?.saon, address?.paon, address?.street]
        .filter((p) => p !== undefined && p !== "")
        .join(" ")
        .trim(),
      locality: address?.town ?? "",
      armsLength: !firstLabel(item.transactionCategory)
        .toLowerCase()
        .includes("additional price paid"),
      source: attribute(SOURCE, date),
    });
  }

  return records;
}

/**
 * The median price of arm's-length sales.
 *
 * Median rather than mean: one £2m outlier in a terraced street moves a mean
 * enough to make every deal in the road look viable.
 */
export function medianPrice(records: readonly PricePaidRecord[]): Money | undefined {
  const prices = records
    .filter((r) => r.armsLength)
    .map((r) => r.price)
    .sort((a, b) => a - b);
  if (prices.length === 0) return undefined;
  const middle = Math.floor(prices.length / 2);
  if (prices.length % 2 === 1) return prices[middle];
  const lower = prices[middle - 1];
  const upper = prices[middle];
  if (lower === undefined || upper === undefined) return undefined;
  return fromMajor(Math.round((lower + upper) / 2 / 100));
}

/** The most recent sale of a given address, if the registry holds one. */
export function latestSale(
  records: readonly PricePaidRecord[],
): PricePaidRecord | undefined {
  return [...records].sort((a, b) => b.date.localeCompare(a.date))[0];
}

const API = "https://landregistry.data.gov.uk/data/ppi/transaction-record.json";

/**
 * Fetch transactions for a postcode.
 *
 * Gated on the licence before the request is made, not after the data is in
 * hand: the exposure is created by taking the data, so refusing at display time
 * would be refusing too late.
 */
export async function fetchPricePaid(
  postcode: string,
  { limit = 100, fetchImpl = fetch }: { limit?: number; fetchImpl?: typeof fetch } = {},
): Promise<readonly PricePaidRecord[]> {
  assertSourceUsable(SOURCE, "internal-analysis");

  const url = new URL(API);
  url.searchParams.set("propertyAddress.postcode", postcode.toUpperCase());
  url.searchParams.set("_pageSize", String(limit));
  url.searchParams.set("_sort", "-transactionDate");

  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Price Paid Data returned ${response.status} for ${postcode}`);
  }
  return parsePricePaidJson(await response.json());
}

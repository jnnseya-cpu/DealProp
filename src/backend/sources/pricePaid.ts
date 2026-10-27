import { assertSourceUsable } from "@shared/domain/sources";
import { fromMajor } from "@shared/money";
import type { PricePaidRecord } from "@backend/discovery/properties";

/**
 * HM Land Registry Price Paid Data, by postcode, from the open linked-data API.
 *
 * Price Paid is published under the Open Government Licence as bulk files and as
 * a SPARQL endpoint. The bulk file is gigabytes and cannot be pasted into a
 * browser, which is why the dataset-paste surface never worked at real scale;
 * this queries the endpoint for one postcode instead, which is what an
 * address-level enrichment actually needs.
 *
 * Like `epc.ts`, this is a direct outbound call to a licensed open API, not a
 * crawl, so it is not routed through the discovery `Fetcher`: there is no
 * robots.txt to consult on a data endpoint and the rate control that matters is
 * the per-call timeout below. It follows no redirect and is bounded in time.
 *
 * VERIFIED LIVE (2026-10-27, from the VPS): the endpoint is reachable and
 * returns results — BUT only once the postcode is a TYPED literal. HMLR's store
 * holds `lrcommon:postcode` as `"B29 6AD"^^xsd:string`, and a plain `"B29 6AD"`
 * literal does not match a typed one in their triplestore, so the first live
 * call returned HTTP 200 with an empty `bindings` array — a valid query against
 * the wrong term, not "no sales". The `^^xsd:string` below is load-bearing;
 * removing it silently returns nothing for every postcode.
 */

const SOURCE = "land-registry-ppd";
const ENDPOINT = "https://landregistry.data.gov.uk/landregistry/query";
const TIMEOUT_MS = 20_000;

/** Only a well-formed UK postcode is interpolated into the query. */
const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

function query(postcode: string): string {
  return `PREFIX ppd: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?paon ?saon ?street ?pricePaid ?transactionDate ?category ?propertyType ?estateType ?newBuild WHERE {
  ?addr lrcommon:postcode "${postcode}"^^xsd:string .
  ?addr lrcommon:paon ?paon .
  ?addr lrcommon:street ?street .
  OPTIONAL { ?addr lrcommon:saon ?saon }
  ?t ppd:propertyAddress ?addr ;
     ppd:pricePaid ?pricePaid ;
     ppd:transactionDate ?transactionDate ;
     ppd:transactionCategory ?category .
  OPTIONAL { ?t ppd:propertyType ?propertyType }
  OPTIONAL { ?t ppd:estateType ?estateType }
  OPTIONAL { ?t ppd:newBuild ?newBuild }
}
ORDER BY DESC(?transactionDate)
LIMIT 200`;
}

interface Binding {
  readonly [k: string]: { readonly value?: string } | undefined;
}

function v(binding: Binding, key: string): string {
  return binding[key]?.value ?? "";
}

/** The letter after the last slash or hash of a URI, lowercased. */
function tail(uri: string): string {
  const m = /[#/]([^#/]+)$/.exec(uri);
  return (m?.[1] ?? uri).toLowerCase();
}

function propertyType(uri: string): string {
  // The HMLR property-type URIs map to the Price Paid single-letter codes.
  const t = tail(uri);
  if (t.includes("detached") && !t.includes("semi")) return "D";
  if (t.includes("semi")) return "S";
  if (t.includes("terraced")) return "T";
  if (t.includes("flat") || t.includes("maisonette")) return "F";
  return "O";
}

function estateType(uri: string): string {
  const t = tail(uri);
  if (t.includes("freehold")) return "F";
  if (t.includes("leasehold")) return "L";
  return "";
}

export function parsePricePaidSparql(json: unknown): readonly PricePaidRecord[] {
  const bindings = (json as { results?: { bindings?: readonly Binding[] } })?.results?.bindings;
  if (!Array.isArray(bindings)) return [];

  const records: PricePaidRecord[] = [];
  for (const b of bindings) {
    const pounds = Number(v(b, "pricePaid"));
    const date = v(b, "transactionDate").slice(0, 10);
    if (!Number.isFinite(pounds) || pounds <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    records.push({
      price: fromMajor(pounds),
      soldAt: date,
      // The caller already knows the postcode it queried; the binding omits it.
      postcode: "",
      propertyType: propertyType(v(b, "propertyType")),
      newBuild: tail(v(b, "newBuild")) === "true" || v(b, "newBuild") === "true",
      tenure: estateType(v(b, "estateType")),
      paon: v(b, "paon"),
      saon: v(b, "saon"),
      street: v(b, "street"),
      category: tail(v(b, "category")).includes("standard") ? "A" : "B",
    });
  }
  return records;
}

/**
 * Registered sales for one postcode, newest first. The postcode is stamped back
 * onto each record so the address key the join builds is complete.
 */
export async function fetchSales(
  postcode: string,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {},
): Promise<readonly PricePaidRecord[]> {
  assertSourceUsable(SOURCE, "internal-analysis");

  const pc = postcode.toUpperCase().trim();
  if (!UK_POSTCODE.test(pc)) return [];

  const url = new URL(ENDPOINT);
  url.searchParams.set("query", query(pc));

  const response = await fetchImpl(url, {
    headers: { accept: "application/sparql-results+json" },
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Price Paid endpoint returned ${response.status} for ${pc}`);

  return parsePricePaidSparql(await response.json()).map((r) => ({ ...r, postcode: pc }));
}

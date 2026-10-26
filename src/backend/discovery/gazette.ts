import { assertSourceUsable } from "@shared/domain/sources";
import type { Provenance } from "@shared/domain/outreach";
import { Fetcher, type FetchResult } from "@backend/discovery/fetcher";
import type { ConnectorResult } from "@backend/discovery/connectors";

/**
 * The Gazette: a probate signal and an insolvency signal, at source.
 *
 * The Gazette is the United Kingdom's official public record, published by The
 * Stationery Office under the Open Government Licence with a free public API —
 * no key, no reseller, no portal. Two kinds of notice in it are the root-cause
 * motivation signals the strategy filters otherwise buy from a listing feed:
 *
 *  - **Deceased-estates notices** placed under the Trustee Act 1925 s.27. An
 *    estate publishes one before distributing, which precedes a sale by
 *    executors. This is the lawful route to "probate", found at its origin
 *    rather than guessed from a portal tag.
 *  - **Personal insolvency notices** — bankruptcy orders, IVAs, debt relief
 *    orders. The root cause behind many "repossessed" listings, in the record
 *    months before a lender lists.
 *
 * Everything here is extraction, never inference, exactly as `extract.ts`
 * requires: a parser returns a field only where the notice states it, and
 * `undefined` for the whole record where the essential field is missing. A
 * postcode is pulled out of a stated address only because it literally appears
 * in it — a substring found, not a value constructed.
 *
 * The people these notices concern are the most vulnerable this platform will
 * ever reach. A deceased person is outside UK GDPR, but the grieving executor
 * is not, and a person in insolvency is precisely who Seller Protection exists
 * for. So a signal from here carries heightened protection and routes to a
 * letter-only, careful approach through the existing outreach spine — never to
 * a faster pursuit. Finding motivation and respecting the person are the same
 * obligation.
 *
 * NOTE ON VERIFICATION: outbound access is blocked in this build environment,
 * so no live call has been made from here. The parsers are fixture-tested
 * against the Gazette's published Atom/JSON field conventions; the licence and
 * host gates are tested against an injected transport. The Gazette's JSON keys
 * carry namespace prefixes that vary by notice type, so confirm the exact field
 * names against one real notice before relying on a production run.
 */

export const GAZETTE_SOURCE = "the-gazette";

/** UK postcode, uppercased, as it literally appears in a stated address. */
const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

function provenanceOf(result: FetchResult): Provenance {
  return {
    sourceKey: GAZETTE_SOURCE,
    sourceUrl: result.url,
    observedAt: result.fetchedAt,
    inferred: false,
  };
}

/** A string from a field that may be a bare value or Atom's `{ "#text": … }`. */
function text(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof value === "object" && value !== null) {
    const held = (value as Record<string, unknown>)["#text"];
    if (typeof held === "string") {
      const trimmed = held.trim();
      return trimmed === "" ? undefined : trimmed;
    }
  }
  return undefined;
}

/** First field present under any of the given keys, extracted verbatim. */
function field(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const found = text(record[key]);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The postcode that literally appears in a stated address, uppercased. */
export function postcodeIn(address: string): string | undefined {
  const match = UK_POSTCODE.exec(address);
  if (match === null) return undefined;
  return `${match[1]} ${match[2]}`.toUpperCase();
}

/* ----------------------------------------------------------------- feed */

/** One notice as the all-notices feed lists it. Nothing is inferred. */
export interface GazetteNotice {
  readonly id: string;
  /** The notice title, verbatim. Never parsed into a name. */
  readonly title: string;
  /** ISO-8601 publication date, as stated. */
  readonly publishedAt: string;
  /** The canonical URL of the notice itself. */
  readonly noticeUrl?: string;
  /** The Gazette notice-type code, where the entry carries one. */
  readonly noticeCode?: string;
  /**
   * The notice's HTML content block, verbatim, where the feed carries one.
   *
   * The all-notices feed inlines the structured body as a small HTML `<dl>` on
   * the entry itself — the deceased's or debtor's address lives here — so the
   * record can be read from the feed without a second request per notice.
   */
  readonly content?: string;
}

/** A link that may be a single object or an array of them. */
function href(link: unknown): string | undefined {
  const entries = Array.isArray(link) ? link : [link];
  for (const entry of entries) {
    if (typeof entry === "string") return entry;
    if (typeof entry === "object" && entry !== null) {
      const object = entry as Record<string, unknown>;
      const rel = text(object["@rel"] ?? object["rel"]);
      const target = text(object["@href"] ?? object["href"]);
      // Prefer the alternate (the notice page) and otherwise take the first.
      if (target !== undefined && (rel === undefined || rel === "alternate")) return target;
    }
  }
  // Fall back to the first href of any shape.
  for (const entry of entries) {
    if (typeof entry === "object" && entry !== null) {
      const target = text((entry as Record<string, unknown>)["@href"] ?? (entry as Record<string, unknown>)["href"]);
      if (target !== undefined) return target;
    }
  }
  return undefined;
}

/**
 * Parse the all-notices feed into a list of notices.
 *
 * Tolerant of a bad entry, intolerant of a bad feed: a single malformed entry
 * is skipped, but a body that is not a feed at all yields an empty list rather
 * than a throw, so a format change surfaces as "nothing found" and is noticed.
 */
export function parseGazetteFeed(json: unknown): readonly GazetteNotice[] {
  if (typeof json !== "object" || json === null) return [];
  const body = json as Record<string, unknown>;
  // The feed may sit at the top level or nested under "feed".
  const feed =
    typeof body["feed"] === "object" && body["feed"] !== null
      ? (body["feed"] as Record<string, unknown>)
      : body;

  const raw = feed["entry"];
  const entries = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];

  const notices: GazetteNotice[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;

    const id = field(record, ["id", "f:id"]);
    const title = field(record, ["title"]);
    const publishedAt = field(record, ["published", "updated", "f:publication-date"]);
    if (id === undefined || title === undefined || publishedAt === undefined) continue;

    const noticeUrl = href(record["link"]);
    const noticeCode = field(record, ["f:notice-code", "notice-code", "f:notice-type"]);
    const content = field(record, ["content", "summary", "f:content"]);

    notices.push({
      id,
      title,
      publishedAt,
      ...(noticeUrl !== undefined ? { noticeUrl } : {}),
      ...(noticeCode !== undefined ? { noticeCode } : {}),
      ...(content !== undefined ? { content } : {}),
    });
  }
  return notices;
}

/* ------------------------------------------------------- deceased estates */

/**
 * A deceased-estates notice, reduced to what matters and what is stated.
 *
 * The address is kept verbatim because it is one free-text line, not a split
 * address; the postcode is pulled from it only where it literally appears, to
 * narrow a later title lookup. The deceased's name is personal data about a
 * person outside UK GDPR; the executor contact is the lawful, published route
 * to the estate.
 */
export interface DeceasedEstateNotice {
  readonly noticeId: string;
  readonly deceasedName: string;
  readonly lastAddress?: string;
  readonly postcode?: string;
  /** ISO-8601, as stated. */
  readonly dateOfDeath?: string;
  /** The person or firm the notice names to receive claims — the lawful route. */
  readonly contactForService?: string;
}

/**
 * The address a notice prints inside its HTML content block.
 *
 * The feed inlines the structured body as a small definition list, and the
 * address sits in the `<dd>` that follows a `<dt>` naming it ("Address of
 * Deceased", "Address of Debtor", "Address"). Extraction, not inference: it
 * returns the line the notice printed, with its tags stripped, or nothing.
 */
function addressFromContent(content: string | undefined): string | undefined {
  if (content === undefined) return undefined;
  const match = /<dt>[^<]*address[^<]*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i.exec(content);
  const raw = match?.[1];
  if (raw === undefined) return undefined;
  const value = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return value === "" ? undefined : value;
}

/**
 * The name a notice carries as its title, with a trailing status marker
 * removed where the Gazette appends one ("(deceased)", "(in bankruptcy)").
 */
function cleanName(title: string | undefined): string | undefined {
  const value = text(title);
  if (value === undefined) return undefined;
  const stripped = value
    .replace(/\s*\((?:deceased|in bankruptcy|in liquidation|in administration)\)\s*$/i, "")
    .trim();
  return stripped === "" ? undefined : stripped;
}

/**
 * Read one deceased-estates notice from its feed entry. Undefined on bad input.
 *
 * Everything needed is on the entry: the deceased's name is the title, the
 * address is in the content `<dl>`. There is deliberately no second request
 * per notice — fetching the per-notice representation and looking there for
 * structured fields it does not carry is exactly what produced a list of
 * notices and no leads against the live feed.
 */
export function parseDeceasedEstate(notice: GazetteNotice): DeceasedEstateNotice | undefined {
  const deceasedName = cleanName(notice.title);
  if (deceasedName === undefined || notice.id === "") return undefined;

  const lastAddress = addressFromContent(notice.content);
  const postcode =
    lastAddress !== undefined ? postcodeIn(lastAddress) : postcodeIn(notice.content ?? "");

  return {
    noticeId: notice.id,
    deceasedName,
    ...(lastAddress !== undefined ? { lastAddress } : {}),
    ...(postcode !== undefined ? { postcode } : {}),
  };
}

/* ----------------------------------------------------------- insolvency */

export type InsolvencyNoticeType =
  | "bankruptcy-order"
  | "individual-voluntary-arrangement"
  | "debt-relief-order"
  | "other";

/**
 * A personal insolvency notice, reduced to what is stated.
 *
 * Distress data about a named, living, vulnerable individual. It may inform a
 * decision to approach by letter under heightened protection; it is never shown
 * to a buyer or published on a card. `internal-analysis` only, which the source
 * licence enforces.
 */
export interface InsolvencyNotice {
  readonly noticeId: string;
  readonly debtorName: string;
  readonly lastAddress?: string;
  readonly postcode?: string;
  readonly noticeType: InsolvencyNoticeType;
  /** ISO-8601, as stated. */
  readonly noticeDate?: string;
}

/** Classify from the stated notice code or title text. Never a guess beyond it. */
function insolvencyType(stated: string | undefined): InsolvencyNoticeType {
  if (stated === undefined) return "other";
  const s = stated.toLowerCase();
  if (s.includes("bankrupt")) return "bankruptcy-order";
  if (s.includes("voluntary arrangement") || /\biva\b/.test(s)) return "individual-voluntary-arrangement";
  if (s.includes("debt relief") || /\bdro\b/.test(s)) return "debt-relief-order";
  return "other";
}

/**
 * Read one personal-insolvency notice from its feed entry. Undefined on bad
 * input. Same shape as the deceased parser: the debtor is the title, the
 * address is in the content, and the order type is classified from whatever
 * the content and title state rather than guessed from the debtor's name.
 */
export function parseInsolvencyNotice(notice: GazetteNotice): InsolvencyNotice | undefined {
  const debtorName = cleanName(notice.title);
  if (debtorName === undefined || notice.id === "") return undefined;

  const lastAddress = addressFromContent(notice.content);
  const postcode =
    lastAddress !== undefined ? postcodeIn(lastAddress) : postcodeIn(notice.content ?? "");
  const stated = [notice.content, notice.title].filter((s): s is string => s !== undefined).join(" ");

  return {
    noticeId: notice.id,
    debtorName,
    ...(lastAddress !== undefined ? { lastAddress } : {}),
    ...(postcode !== undefined ? { postcode } : {}),
    noticeType: insolvencyType(stated),
    ...(notice.publishedAt !== "" ? { noticeDate: notice.publishedAt } : {}),
  };
}

/* ------------------------------------------------------------ connector */

/**
 * The Gazette notice types this adapter knows how to read.
 *
 * Deceased estates and personal insolvency map to distinct notice-code groups
 * in the all-notices feed. The codes themselves are a configuration the caller
 * supplies, because they are the one part this environment cannot confirm
 * against a live request — the adapter does not hardcode a code it has not
 * seen the API return.
 */
export interface GazetteQuery {
  /** The notice-code or notice-type filter, as the Gazette API expects it. */
  readonly noticeCode: string;
  /** Results start date, ISO-8601, where the feed is filtered by date. */
  readonly start?: string;
  /** Results end date, ISO-8601. */
  readonly end?: string;
  /** How many notices one request returns. The feed's default is small (~10). */
  readonly pageSize?: number;
  /** 1-based page number, for reading beyond the first page. */
  readonly page?: number;
}

const FEED_PATH = "/all-notices/notice/data.json";

function feedUrl(host: string, query: GazetteQuery): string {
  const url = new URL(`https://${host}${FEED_PATH}`);
  url.searchParams.set("noticetypes", query.noticeCode);
  if (query.start !== undefined) url.searchParams.set("start-publish-date", query.start);
  if (query.end !== undefined) url.searchParams.set("end-publish-date", query.end);
  if (query.pageSize !== undefined) url.searchParams.set("results-page-size", String(query.pageSize));
  if (query.page !== undefined) url.searchParams.set("results-page", String(query.page));
  return url.toString();
}

/**
 * Fetch one page of notices of a given type from the all-notices feed.
 *
 * Licence-gated by the Fetcher like every other outbound read, and parsed into
 * the lightweight feed shape. The name and address for each notice are read
 * from the entry's own title and inlined content, so a page of the feed is all
 * the data a run needs — there is no second request per notice.
 */
export async function fetchNotices(
  fetcher: Fetcher,
  query: GazetteQuery,
  host = "www.thegazette.co.uk",
): Promise<ConnectorResult<readonly GazetteNotice[]>> {
  assertSourceUsable(GAZETTE_SOURCE, "internal-analysis");

  const result = await fetcher.get(GAZETTE_SOURCE, feedUrl(host, query), {
    headers: { accept: "application/json" },
  });
  if (!result.ok || result.body === undefined) return { ok: false, reason: result.reason };

  try {
    const notices = parseGazetteFeed(JSON.parse(result.body));
    return {
      ok: true,
      value: notices,
      reason:
        notices.length > 0
          ? `${notices.length} notice(s) of type ${query.noticeCode}.`
          : "The feed held no notices for that query.",
      provenance: provenanceOf(result),
    };
  } catch {
    return { ok: false, reason: "The feed could not be read as JSON." };
  }
}

/** Read one notice's structured body, for the deceased/debtor fields. */
export async function fetchNotice(
  fetcher: Fetcher,
  noticeUrl: string,
): Promise<ConnectorResult<unknown>> {
  assertSourceUsable(GAZETTE_SOURCE, "internal-analysis");

  // The structured representation is the notice URL with a data.json suffix.
  const dataUrl = noticeUrl.endsWith("/data.json")
    ? noticeUrl
    : `${noticeUrl.replace(/\/$/, "")}/data.json`;

  const result = await fetcher.get(GAZETTE_SOURCE, dataUrl, {
    headers: { accept: "application/json" },
  });
  if (!result.ok || result.body === undefined) return { ok: false, reason: result.reason };

  try {
    return {
      ok: true,
      value: JSON.parse(result.body),
      reason: "Notice body read.",
      provenance: provenanceOf(result),
    };
  } catch {
    return { ok: false, reason: "The notice body could not be read as JSON." };
  }
}

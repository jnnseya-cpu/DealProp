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

/**
 * The URL of a notice's machine-readable representation.
 *
 * The feed hands back either the resource page (…/notice/5237386) or, in some
 * responses, the identifier URI (…/id/notice/5237386). The readable data lives
 * at the RESOURCE path with a /data.jsonld (or /data.json) suffix — there is no
 * …/id/notice/…/data.jsonld, so appending the suffix to the identifier form 404s
 * and the lead's letter is left with no recipient. Normalise any of those forms
 * to the one fetchable resource. The notice id may contain a dash (2345-6789),
 * so it is matched as a run of word characters and dashes, not just digits.
 */
export function noticeDataUrl(noticeUrl: string, suffix: "data.jsonld" | "data.json"): string {
  const stripped = noticeUrl.replace(/\/(?:data\.jsonld|data\.json)\/?$/i, "").replace(/\/$/, "");
  const idForm = /^(https?:\/\/[^/]+)\/id\/notice\/([\w-]+)/i.exec(stripped);
  const base = idForm !== null ? `${idForm[1]}/notice/${idForm[2]}` : stripped;
  return `${base}/${suffix}`;
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
  /** ISO-8601 deadline for claims against the estate, where stated. */
  readonly claimDeadline?: string;
  /** The notice's public page, for opening the source from inside Lode. */
  readonly noticeUrl?: string;
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
 * The office-holder a notice prints in its own content block.
 *
 * Some notices carry, in the same definition list as the address, the person or
 * firm to whom claims are to be given (the executor/solicitor, on a probate
 * notice) or the appointed trustee (on an insolvency notice). Where they do, the
 * lawful recipient is read straight from the feed entry we already fetched — no
 * second request, so it cannot be defeated by a per-notice page being gated or
 * moved — and the letter is addressable the moment the lead is produced.
 *
 * Extraction, never inference: it takes the `<dd>` of a `<dt>` whose label NAMES
 * a representative, and never the subject's own address line ("Address of
 * Deceased" / "Address of Debtor"), which would hand the letter back to exactly
 * the vulnerable person it must not be sent to.
 */
function contactFromContent(content: string | undefined): string | undefined {
  if (content === undefined) return undefined;
  const pairs = /<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi;
  const NAMES =
    /representative|executor|administrator|trustee|practitioner|liquidator|receiver|solicitor|claims|person to whom|deliver|notices are to be/;
  for (let m = pairs.exec(content); m !== null; m = pairs.exec(content)) {
    const label = (m[1] ?? "").replace(/<[^>]*>/g, " ").toLowerCase();
    // Never the subject's own address, however it is phrased.
    if (/deceased|debtor|bankrupt/.test(label)) continue;
    if (!NAMES.test(label)) continue;
    const value = (m[2] ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    if (value !== "") return value;
  }
  return undefined;
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
  // The postcode comes ONLY from the deceased's own address line, never from a
  // scan of the whole notice body. A deceased-estates notice always prints the
  // executor's or solicitor's address too ("send claims to …"), and a
  // whole-content fallback grabbed *that* postcode when the deceased's address
  // line carried none — producing a lead whose postcode belonged to the
  // solicitor, not the property, and falsely promoting it to "strong". Where the
  // stated address has no postcode, the lead has none: it is worth a look and the
  // property must be identified first, which is honest. (Do not reintroduce a
  // postcodeIn(notice.content) fallback — it is the bug this records.)
  const postcode = lastAddress !== undefined ? postcodeIn(lastAddress) : undefined;
  // The lawful recipient, where the notice prints it in the feed content — so
  // the letter is addressable without a second request. Absent here, it is
  // resolved on demand from the notice's own page (fetchNoticeDetail).
  const contactForService = contactFromContent(notice.content);

  return {
    noticeId: notice.id,
    deceasedName,
    ...(lastAddress !== undefined ? { lastAddress } : {}),
    ...(postcode !== undefined ? { postcode } : {}),
    ...(contactForService !== undefined ? { contactForService } : {}),
    ...(notice.noticeUrl !== undefined ? { noticeUrl: notice.noticeUrl } : {}),
  };
}

/* ----------------------------------------------- notice contact for service */

/** What a notice's own page adds beyond the feed listing. */
export interface NoticeDetail {
  /** The executor/solicitor named to receive claims — who to lawfully write to. */
  readonly contactForService?: string;
  /** ISO-8601 claim deadline, where the notice states one. */
  readonly claimDeadline?: string;
}

/** The nodes of a JSON-LD document, whether it is a @graph or a single node. */
function graphOf(json: unknown): readonly Record<string, unknown>[] {
  if (typeof json !== "object" || json === null) return [];
  const body = json as Record<string, unknown>;
  const graph = body["@graph"];
  if (Array.isArray(graph)) {
    return graph.filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null);
  }
  return [body];
}

/**
 * The local name of a JSON-LD key: the part after the last `#` or `/`, lowered.
 *
 * The Gazette's JSON-LD serialises its predicates as expanded IRIs
 * (`https://www.thegazette.co.uk/def/…#hasPersonalRepresentative`) at least as
 * often as compact terms, and an exact-string lookup for `hasPersonalRepresentative`
 * misses the expanded form entirely — which is why the on-demand contact came
 * back empty against real notices. Matching on the local name reads both.
 */
function localName(key: string): string {
  const tail = key.split(/[#/]/).pop() ?? key;
  return tail.toLowerCase();
}

/** First string value whose key's local name is one of `names`, Atom-wrapped or bare. */
function byLocalName(node: Record<string, unknown>, names: readonly string[]): string | undefined {
  const want = new Set(names.map((n) => n.toLowerCase()));
  for (const [key, value] of Object.entries(node)) {
    if (!want.has(localName(key))) continue;
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    const t = text(value);
    if (t !== undefined) return t;
  }
  return undefined;
}

/** First value whose key's local name is one of `names`, whatever its shape. */
function valueByLocalName(node: Record<string, unknown>, names: readonly string[]): unknown {
  const want = new Set(names.map((n) => n.toLowerCase()));
  for (const [key, value] of Object.entries(node)) {
    if (want.has(localName(key))) return value;
  }
  return undefined;
}

/** The office-holder predicates to write to, by local name (probate + insolvency). */
const OFFICE_HOLDER = new Set([
  "haspersonalrepresentative",
  "hasinsolvencypractitioner",
  "hasofficeholder",
  "hastrustee",
  "hasadministrator",
  "hasliquidator",
  "hasreceiver",
  "hasofficialreceiver",
  "hasinsolvencyintermediary",
  "hasinsolvencyservicesofficeholder",
  "personalrepresentative",
  "trustee",
  "officeholder",
  "representative",
]);

/**
 * The contact for service and claim deadline from a notice's JSON-LD.
 *
 * The notice node names its personal representative (the executor — the lawful
 * contact), or a trustee / Official Receiver on an insolvency notice, either by
 * reference (an `@id` resolved from the graph) or inline as a nested object. Its
 * name and address are read by local name, so an expanded-IRI representation
 * still yields what it has rather than nothing.
 */
export function parseNoticeDetail(json: unknown): NoticeDetail {
  const graph = graphOf(json);
  const byId = new Map<string, Record<string, unknown>>();
  for (const node of graph) {
    const id = node["@id"];
    if (typeof id === "string") byId.set(id, node);
  }

  let claimDeadline: string | undefined;
  let repNode: Record<string, unknown> | undefined;
  for (const node of graph) {
    if (claimDeadline === undefined) {
      claimDeadline = byLocalName(node, ["hasClaimDeadline", "claimDeadline", "deadlineForClaims"]);
    }
    if (repNode === undefined) {
      for (const [key, value] of Object.entries(node)) {
        if (!OFFICE_HOLDER.has(localName(key))) continue;
        // A reference (the @id of another node), or the representative inline.
        if (typeof value === "string") {
          const resolved = byId.get(value);
          if (resolved !== undefined) {
            repNode = resolved;
            break;
          }
        } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          repNode = value as Record<string, unknown>;
          break;
        }
      }
    }
  }

  const contactForService = contactFromNode(repNode, byId);

  return {
    ...(contactForService !== undefined ? { contactForService } : {}),
    ...(claimDeadline !== undefined ? { claimDeadline } : {}),
  };
}

/** Name + address out of a representative node, resolving a referenced address. */
function contactFromNode(
  node: Record<string, unknown> | undefined,
  byId: Map<string, Record<string, unknown>>,
): string | undefined {
  if (node === undefined) return undefined;

  const name = byLocalName(node, [
    "name", "hasName", "label", "title", "fullName", "legalName", "organisationName",
  ]);

  // The address may be a reference to an address node (an @id string), the
  // address inline as an object, or a plain string on the node itself. Resolve a
  // reference first, because the reference value is itself a string (the @id)
  // and would otherwise be mistaken for the address.
  let address: string | undefined;
  let addrValue = valueByLocalName(node, ["hasAddress", "address", "postalAddress", "location"]);
  if (typeof addrValue === "string" && byId.has(addrValue)) {
    addrValue = byId.get(addrValue);
  }
  if (typeof addrValue === "object" && addrValue !== null && !Array.isArray(addrValue)) {
    const an = addrValue as Record<string, unknown>;
    const composed = [
      byLocalName(an, ["streetAddress", "address", "paon", "saon", "street", "addressLine1", "line1"]),
      byLocalName(an, ["locality", "town", "addressLocality", "postTown"]),
      byLocalName(an, ["postalCode", "postcode", "postCode"]),
    ]
      .filter((p): p is string => p !== undefined && p !== "")
      .join(", ");
    if (composed !== "") address = composed;
  } else if (typeof addrValue === "string" && addrValue.trim() !== "") {
    address = addrValue.trim();
  }

  const parts = [name, address].filter((p): p is string => p !== undefined && p !== "");
  return parts.length > 0 ? parts.join(" — ") : undefined;
}

/**
 * Read one notice's own page for the contact for service and claim deadline.
 *
 * Licence- and host-gated by the Fetcher like every Gazette read. Used to
 * enrich a probate lead with the lawful contact, so the operator never leaves
 * Lode to find who to write to. Only called for a bounded number of leads.
 */
export async function fetchNoticeDetail(
  fetcher: Fetcher,
  noticeUrl: string,
): Promise<ConnectorResult<NoticeDetail>> {
  assertSourceUsable(GAZETTE_SOURCE, "internal-analysis");

  const url = noticeDataUrl(noticeUrl, "data.jsonld");

  const result = await fetcher.get(GAZETTE_SOURCE, url, {
    headers: { accept: "application/ld+json, application/json" },
  });
  if (!result.ok || result.body === undefined) return { ok: false, reason: result.reason };

  try {
    return {
      ok: true,
      value: parseNoticeDetail(JSON.parse(result.body)),
      reason: "ok",
      provenance: provenanceOf(result),
    };
  } catch {
    return { ok: false, reason: "The notice detail could not be read as JSON." };
  }
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
  /**
   * The trustee / Official Receiver named in the notice — the lawful recipient,
   * never the debtor — where the feed content prints it. Absent, it is resolved
   * on demand from the notice's own page.
   */
  readonly contactForService?: string;
  /** The notice's public page, for opening the source from inside Lode. */
  readonly noticeUrl?: string;
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
  // Postcode from the debtor's own address line only — never a scan of the whole
  // body, which would pick up the trustee's or practitioner's postcode printed
  // elsewhere in the notice. See parseDeceasedEstate for the bug this records.
  const postcode = lastAddress !== undefined ? postcodeIn(lastAddress) : undefined;
  const stated = [notice.content, notice.title].filter((s): s is string => s !== undefined).join(" ");
  // The trustee / Official Receiver, where the feed content names one — so the
  // bankruptcy letter is addressable without a second request. Never the debtor.
  const contactForService = contactFromContent(notice.content);

  return {
    noticeId: notice.id,
    debtorName,
    ...(lastAddress !== undefined ? { lastAddress } : {}),
    ...(postcode !== undefined ? { postcode } : {}),
    noticeType: insolvencyType(stated),
    ...(notice.publishedAt !== "" ? { noticeDate: notice.publishedAt } : {}),
    ...(contactForService !== undefined ? { contactForService } : {}),
    ...(notice.noticeUrl !== undefined ? { noticeUrl: notice.noticeUrl } : {}),
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

  // The structured representation is the notice RESOURCE with a data.json suffix
  // (never the …/id/notice/ identifier form — see noticeDataUrl).
  const dataUrl = noticeDataUrl(noticeUrl, "data.json");

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

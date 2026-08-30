import type { DiscoveredFact, Provenance, RecipientType } from "@shared/domain/outreach";

/**
 * Reading a funder's own published page.
 *
 * Everything here is extraction, never inference. That distinction is the whole
 * point of this file, so it is enforced structurally rather than promised: the
 * only way to produce a fact is `published()`, which takes the exact substring
 * found in the document, and there is no code path that constructs a contact
 * detail from parts.
 *
 * The address that would be invented if this were careless is
 * `firstname.lastname@domain`. It looks right, it is frequently correct, and it
 * belongs to a real person who never published it — so writing to it is
 * unsolicited contact with somebody who was never asked. Guessing is not
 * collection, and a guessed address has no source, no observation date and no
 * lawful basis to record.
 */

/** The only constructor of a fact. Requires the value to have been found. */
function published<T>(value: T, provenance: Omit<Provenance, "inferred">): DiscoveredFact<T> {
  return { value, provenance: { ...provenance, inferred: false } };
}

export interface ExtractedContacts {
  /** Addresses published on the page, in preference order. */
  readonly emails: readonly DiscoveredFact<string>[];
  readonly phones: readonly DiscoveredFact<string>[];
  readonly enquiryForms: readonly DiscoveredFact<string>[];
  readonly mandateText?: DiscoveredFact<string>;
  /**
   * Addresses found but not used, with the reason.
   *
   * Recorded rather than discarded so that a reviewer can see the page was read
   * properly and a decision was made, rather than wondering whether the
   * extractor simply missed something.
   */
  readonly rejected: readonly { readonly value: string; readonly why: string }[];
}

/** Mailboxes a business publishes to be written to. */
const ROLE_MAILBOXES = [
  "enquiries", "enquiry", "info", "hello", "contact", "lending", "newbusiness",
  "new.business", "deals", "broker", "brokers", "intermediaries", "originations",
  "underwriting", "admin", "office", "mail",
];

/** Mailboxes that are somebody's personal work address rather than a channel. */
function looksPersonal(local: string): boolean {
  const l = local.toLowerCase();
  if (ROLE_MAILBOXES.includes(l)) return false;
  // first.last, f.last, firstlast-surname and similar shapes.
  if (/^[a-z]+[._-][a-z]+$/.test(l)) return true;
  if (/^[a-z]\.[a-z]+$/.test(l)) return true;
  return false;
}

const EMAIL = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
const UK_PHONE = /(?:\+44\s?|\b0)(?:\d\s?){9,10}\d\b/g;

/**
 * Extract published contact channels from one page of a funder's own site.
 *
 * @param html   The document as fetched. Never a summary of it.
 * @param domain The organisation's verified domain. An address on another
 *               domain is somebody else's and is not taken.
 */
export function extractContacts(
  html: string,
  domain: string,
  provenance: Omit<Provenance, "inferred">,
): ExtractedContacts {
  const text = stripTags(html);
  const rejected: { value: string; why: string }[] = [];

  const emails: DiscoveredFact<string>[] = [];
  const seen = new Set<string>();

  // mailto: links first: an address the site deliberately made clickable is the
  // one it intends to be written to.
  const mailtos = [...html.matchAll(/mailto:([^"'?>\s]+)/gi)].map((m) => m[1] ?? "");
  for (const candidate of [...mailtos, ...(text.match(EMAIL) ?? [])]) {
    const address = candidate.trim().toLowerCase();
    if (address === "" || seen.has(address)) continue;
    seen.add(address);

    const [local, host] = address.split("@");
    if (local === undefined || host === undefined) continue;

    if (!sameOrganisation(host, domain)) {
      rejected.push({
        value: address,
        why: `On ${host}, not ${domain}. An address on another domain belongs to somebody else.`,
      });
      continue;
    }
    if (looksPersonal(local)) {
      rejected.push({
        value: address,
        why: "A named individual's mailbox. Outreach goes to a published business channel, not to a person who has not been told why we have their address.",
      });
      continue;
    }
    emails.push(published(address, provenance));
  }

  const phones = [...new Set(text.match(UK_PHONE) ?? [])].map((p) =>
    published(p.replace(/\s+/g, " ").trim(), provenance),
  );

  const enquiryForms = [...html.matchAll(/href=["']([^"']*(?:contact|enquir)[^"']*)["']/gi)]
    .map((m) => m[1] ?? "")
    .filter((href) => href !== "" && !href.startsWith("mailto:"))
    .slice(0, 3)
    .map((href) => published(absolute(href, domain), provenance));

  const mandate = findMandate(text);

  return {
    // Role mailboxes first: they are the ones published to be written to.
    emails: [...emails].sort((a, b) => rank(a.value) - rank(b.value)),
    phones,
    enquiryForms,
    ...(mandate !== undefined ? { mandateText: published(mandate, provenance) } : {}),
    rejected,
  };
}

function rank(address: string): number {
  const local = address.split("@")[0] ?? "";
  return ROLE_MAILBOXES.includes(local.toLowerCase()) ? 0 : 1;
}

/** Same registrable organisation, allowing a subdomain of it. */
function sameOrganisation(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

function absolute(href: string, domain: string): string {
  if (href.startsWith("http")) return href;
  return `https://${domain}${href.startsWith("/") ? "" : "/"}${href}`;
}

/**
 * The sentence or two describing what the organisation lends against.
 *
 * Taken verbatim from the page, never summarised. A summary is a new statement
 * about somebody else's business, and if it is wrong we made it up.
 */
function findMandate(text: string): string | undefined {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const signal =
    /\b(we lend|we fund|we provide|loans? from|facilit(y|ies) from|£[\d,]+\s*(k|m|million)?\s*(to|–|-)\s*£?[\d,]+|bridging|development finance|mezzanine|first charge|second charge|LTV|GDV)\b/i;

  const hit = sentences.find((s) => signal.test(s) && s.length > 40 && s.length < 400);
  return hit?.replace(/\s+/g, " ").trim();
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------- official records */

export interface CompanyRecord {
  readonly companyNumber: string;
  readonly name: string;
  readonly status: string;
  /** True where the company is not actively trading: dissolved, liquidation. */
  readonly inactive: boolean;
  readonly incorporatedOn?: string;
}

/** Companies House company profile, from the official API. */
export function parseCompanyProfile(json: unknown): CompanyRecord | undefined {
  if (typeof json !== "object" || json === null) return undefined;
  const record = json as Record<string, unknown>;
  const number = record["company_number"];
  const name = record["company_name"];
  const status = record["company_status"];
  if (typeof number !== "string" || typeof name !== "string") return undefined;

  const state = typeof status === "string" ? status : "unknown";
  return {
    companyNumber: number,
    name,
    status: state,
    // Anything other than active or in a voluntary arrangement is a company we
    // do not write to about somebody's property transaction.
    inactive: !["active", "voluntary-arrangement"].includes(state),
    ...(typeof record["date_of_creation"] === "string"
      ? { incorporatedOn: record["date_of_creation"] }
      : {}),
  };
}

export interface RegisterRecord {
  readonly firmReference: string;
  readonly name: string;
  readonly status: string;
  readonly authorised: boolean;
}

/** FCA Register firm details, from the official API. */
export function parseFirmDetails(json: unknown): RegisterRecord | undefined {
  if (typeof json !== "object" || json === null) return undefined;
  const body = json as Record<string, unknown>;
  const data = Array.isArray(body["Data"]) ? body["Data"][0] : undefined;
  if (typeof data !== "object" || data === null) return undefined;
  const record = data as Record<string, unknown>;

  const frn = record["FRN"];
  const name = record["Organisation Name"];
  const status = record["Status"];
  if (typeof frn !== "string" || typeof name !== "string") return undefined;

  const state = typeof status === "string" ? status : "unknown";
  return {
    firmReference: frn,
    name,
    status: state,
    // "Authorised" and nothing else. "No longer authorised", "Applied to
    // cancel" and an appointed representative's own entry are not the same
    // thing, and treating them as equivalent is how a cloned or lapsed firm
    // passes verification.
    authorised: state.toLowerCase() === "authorised",
  };
}

/** Legal form from a company name, for the PECR recipient-type decision. */
export function recipientTypeFromName(name: string): RecipientType {
  const n = name.trim().toLowerCase();
  if (/\bllp\b/.test(n)) return "llp";
  if (/\b(limited|ltd|plc|cic|c\.i\.c)\b/.test(n)) return "limited-company";
  // Everything else is unknown, which the eligibility engine treats as an
  // individual. Guessing "probably a company" is how a lawful B2B campaign
  // becomes an unlawful one.
  return "unknown";
}

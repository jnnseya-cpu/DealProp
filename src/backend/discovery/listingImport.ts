import { assertSourceUsable } from "@shared/domain/sources";
import {
  classifyImportUrl,
  isListingNode,
  mapListingJsonLd,
  type ImportedListing,
} from "@shared/domain/listingImport";
import { Fetcher } from "@backend/discovery/fetcher";
import type { ConnectorResult } from "@backend/discovery/connectors";

/**
 * Reading a rights-holder's own listing page for its facts.
 *
 * The lawful import, end to end: the link is classified first, so a portal or a
 * non-public host is refused before any request is made; the fetch then goes
 * through the Fetcher, which checks the licence, binds the request to the
 * submitted domain, obeys robots.txt and rate-limits like every other outbound
 * read; and what is extracted is the page's own structured data — the
 * schema.org JSON-LD a publisher embeds precisely so machines can read it —
 * reduced to facts. The photographs and the marketing text are never taken.
 *
 * NOTE ON VERIFICATION: outbound access is blocked in this environment, so no
 * live import has been made from here. The parser is fixture-tested against the
 * JSON-LD conventions; the gate is tested against an injected transport. Make
 * one live import from a real auction or agent page before relying on it.
 */

export const LISTING_IMPORT_SOURCE = "listing-import";

/** Pull every JSON-LD block out of a page, tolerant of a malformed one. */
export function extractJsonLd(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const block of blocks) {
    const raw = block[1];
    if (raw === undefined) continue;
    try {
      const parsed: unknown = JSON.parse(raw.trim());
      // A block may be one node, an array of nodes, or a @graph of them.
      const candidates = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as Record<string, unknown>)["@graph"])
          ? ((parsed as Record<string, unknown>)["@graph"] as unknown[])
          : [parsed];
      for (const c of candidates) {
        if (typeof c === "object" && c !== null) nodes.push(c as Record<string, unknown>);
      }
    } catch {
      // One malformed block is a fact about the page, not a reason to fail.
    }
  }
  return nodes;
}

/** The first node that looks like a property listing. */
export function pickListingNode(
  nodes: readonly Record<string, unknown>[],
): Record<string, unknown> | undefined {
  return nodes.find((n) => isListingNode(n));
}

/**
 * Import the facts of a listing the submitter is entitled to publish.
 *
 * Returns a refusal rather than throwing: a portal link, a page with no
 * structured data, or a site that refuses the fetch are all ordinary outcomes a
 * person needs to be told about, not errors.
 */
export async function importListing(
  url: string,
  options: { readonly fetcher?: Fetcher } = {},
): Promise<ConnectorResult<ImportedListing>> {
  const classification = classifyImportUrl(url);
  if (classification.kind !== "importable" || classification.host === undefined) {
    return { ok: false, reason: classification.reason };
  }

  assertSourceUsable(LISTING_IMPORT_SOURCE, "display");

  const fetcher = options.fetcher ?? new Fetcher();
  const result = await fetcher.get(LISTING_IMPORT_SOURCE, url, {
    candidateDomain: classification.host,
  });
  if (!result.ok || result.body === undefined) return { ok: false, reason: result.reason };

  const node = pickListingNode(extractJsonLd(result.body));
  if (node === undefined) {
    return {
      ok: false,
      reason:
        "That page has no structured property data we can read. Enter the details by hand — you can still publish the property here.",
    };
  }

  const facts = mapListingJsonLd(node);
  const listing: ImportedListing = {
    sourceUrl: result.url,
    publisherHost: classification.host,
    ...facts,
  };

  // Facts, but nothing to act on: an empty shell is not an import.
  const hasFact =
    listing.address !== undefined ||
    listing.postcode !== undefined ||
    listing.priceGbp !== undefined ||
    listing.title !== undefined;
  if (!hasFact) {
    return { ok: false, reason: "The structured data on that page held no usable property facts." };
  }

  return {
    ok: true,
    value: listing,
    reason: "Facts read from the page's own structured data. Photographs and description were not taken.",
    provenance: {
      sourceKey: LISTING_IMPORT_SOURCE,
      sourceUrl: result.url,
      observedAt: result.fetchedAt,
      inferred: false,
    },
  };
}

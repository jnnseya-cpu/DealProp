import { assertSourceUsable } from "@shared/domain/sources";

/**
 * HM Land Registry title register — the live reader behind `lookupOwner`.
 *
 * `owners.ts` already does everything except the network call: it checks the
 * licence, the title-number shape, the deal id and the named requester, then
 * hands a title number to a `reader` and parses the proprietors out of what
 * comes back. This is that reader, plus the address→title search that finds the
 * title number in the first place.
 *
 * Like `epc.ts` and `pricePaid.ts`, this is a direct, authenticated call to a
 * licensed API HMLR grants per account, not a crawl, so it is not routed through
 * the discovery Fetcher: the controls that apply are the licence gate, the
 * credential, a pinned host, a refusal to follow a redirect that could carry the
 * credential off that host, and a bounded timeout.
 *
 * It is bought ONE TITLE AT A TIME, for a property genuinely being pursued —
 * which is why `owners.ts` refuses a lookup with no deal behind it. There is no
 * bulk path here and there must never be one.
 *
 * NOTE ON VERIFICATION: no credential is configured and no live call has been
 * made. The request and the two parsers below are written to the shape HMLR's
 * official-copy and property-description services are expected to return, but
 * the exact endpoint, authentication scheme and field names are confirmed only
 * once a Business Gateway (or current equivalent) account is granted — see
 * docs/HMLR-ACCESS.md. The parsers are deliberately tolerant and are unit-tested
 * against fixtures; expect to adjust the field mapping, not the structure, when
 * the live response is in hand. Until credentials exist every call fails closed.
 */

const SOURCE = "land-registry-title";
/** How long a single HMLR request may take before it is abandoned. */
const TIMEOUT_MS = 20_000;

/** The register as `parseProprietors()` in owners.ts consumes it. */
export interface RegisterView {
  readonly proprietors: readonly {
    readonly name: string;
    readonly addressForService?: string;
    readonly companyNumber?: string;
  }[];
}

/**
 * The credentials, read at call time so a process that never looks up a title
 * does not need them to exist. Fails closed — an unconfigured import must refuse
 * rather than quietly return nothing and let a caller conclude a property has no
 * registered owner. The exact scheme (key, bearer token or client certificate)
 * is whatever HMLR issues; this reads a base URL and a key and sends the key as
 * a bearer token, which the adapter note says to confirm on onboarding.
 */
function credentials(): { readonly base: string; readonly key: string } {
  const base = process.env.HMLR_TITLE_API_BASE;
  const key = process.env.HMLR_TITLE_API_KEY;
  if (base === undefined || base === "" || key === undefined || key === "") {
    throw new Error(
      "HM Land Registry title API is not configured; set HMLR_TITLE_API_BASE and HMLR_TITLE_API_KEY. Refusing to query.",
    );
  }
  return { base, key };
}

async function hmlrGet(path: string, params: Record<string, string>): Promise<unknown> {
  assertSourceUsable(SOURCE, "internal-analysis");
  const { base, key } = credentials();

  const url = new URL(`${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) if (v !== "") url.searchParams.set(k, v);

  const response = await fetch(url, {
    headers: { accept: "application/json", authorization: `Bearer ${key}` },
    // The request carries a credential; a redirect to another host would hand it
    // somewhere we did not licence. Bounded in time, like the other adapters.
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HM Land Registry returned ${response.status}`);
  }
  return response.json();
}

const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

/**
 * Map an official copy of the register onto the proprietor view owners.ts reads.
 *
 * Tolerant by design: the proprietorship register may arrive as `proprietors`,
 * `proprietorship`, or nested under a `register` object, and each proprietor's
 * name / address-for-service / company-number under any of a few plausible keys.
 * Nothing is inferred — an entry with no address yields a proprietor without
 * one, because the address for service is frequently not the property and must
 * never be guessed from it. Exported and unit-tested so the field mapping can be
 * pinned to the live response without touching the fetch.
 */
export function registerFromOfficialCopy(body: unknown): RegisterView {
  if (typeof body !== "object" || body === null) return { proprietors: [] };
  const root = body as Record<string, unknown>;
  const register = (typeof root.register === "object" && root.register !== null ? root.register : root) as Record<string, unknown>;

  const raw =
    register.proprietors ?? register.proprietorship ?? register.proprietorshipRegister ?? root.proprietors;
  if (!Array.isArray(raw)) return { proprietors: [] };

  const proprietors: { name: string; addressForService?: string; companyNumber?: string }[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const r = entry as Record<string, unknown>;
    const name = asString(r.name) ?? asString(r.proprietorName) ?? asString(r.proprietor);
    if (name === undefined) continue;
    const address =
      asString(r.addressForService) ?? asString(r.address) ?? asString(r.correspondenceAddress);
    const company = asString(r.companyNumber) ?? asString(r.companyRegistrationNumber);
    proprietors.push({
      name,
      ...(address !== undefined ? { addressForService: address } : {}),
      ...(company !== undefined ? { companyNumber: company } : {}),
    });
  }
  return { proprietors };
}

/**
 * The reader `lookupOwner` expects: a title number in, the register view out.
 *
 *   lookupOwner(request, (title) => fetchTitleRegister(title))
 */
export async function fetchTitleRegister(titleNumber: string): Promise<RegisterView> {
  const body = await hmlrGet("official-copies", { title_number: titleNumber });
  return registerFromOfficialCopy(body);
}

/** Title numbers from a Search by Property Description response, tolerantly. */
export function titleNumbersFrom(body: unknown): readonly string[] {
  if (typeof body !== "object" || body === null) return [];
  const root = body as Record<string, unknown>;
  const list = root.titles ?? root.results ?? root.data;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      const s = item.trim();
      if (s !== "") out.push(s);
      continue;
    }
    if (typeof item === "object" && item !== null) {
      const t = asString((item as Record<string, unknown>).titleNumber) ?? asString((item as Record<string, unknown>).title_number);
      if (t !== undefined) out.push(t);
    }
  }
  return [...new Set(out)];
}

/**
 * Find the title number(s) for an address, so a lead's postcode can become a
 * title before the official copy is ordered. The register is bought per title;
 * this is the search that precedes it, and it is still tied to one property.
 */
export async function searchTitleByAddress(
  address: string,
  postcode: string,
): Promise<readonly string[]> {
  const body = await hmlrGet("search-property-description", {
    address: address.trim(),
    postcode: postcode.toUpperCase().trim(),
  });
  return titleNumbersFrom(body);
}

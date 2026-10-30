import { money } from "@shared/money";
import { attribute, getSource } from "@shared/domain/sources";
import { companyIdentity } from "@shared/domain/identity";
import { draftProbateLetter } from "@shared/domain/probateLetter";
import { draftInsolvencyLetter } from "@shared/domain/insolvencyLetter";
import { draftHomeownerLetter } from "@shared/domain/homeownerLetter";
import { messageOf } from "@backend/report";
import type {
  FlipEvidence,
  LeadSignal,
  SourceReadiness,
  SourcedLead,
} from "@shared/domain/sourcedLead";
import {
  EPC_SOURCE,
  PPD_SOURCE,
  addressKey,
  findCandidates,
  findFlips,
  medianPricePerSqm,
  negativeEquity,
  parseEpc,
  parsePricePaid,
  splitAddressLine,
  type CandidateSearch,
  type EpcRecord,
  type PricePaidRecord,
  type PropertyCandidate,
} from "@backend/discovery/properties";
import { fetchCertificates, searchCertificates, type EpcCertificate } from "@backend/sources/epc";
import { fetchSales } from "@backend/sources/pricePaid";
import { MINIMUM_MONTHS } from "@backend/discovery/properties";
import {
  GAZETTE_SOURCE,
  fetchNotices,
  parseDeceasedEstate,
  parseInsolvencyNotice,
  type DeceasedEstateNotice,
  type InsolvencyNotice,
} from "@backend/discovery/gazette";
import { INSOLVENCY_SOURCE } from "@backend/discovery/insolvencyRegister";
import { Fetcher } from "@backend/discovery/fetcher";
import { DEFAULT_PRIORITY_AREAS, isPriorityArea, parsePriorityAreas } from "@shared/domain/sourcingArea";

/**
 * Turning the register adapters into a list of leads a person can work.
 *
 * Each adapter — Price Paid joined to the EPC register, the Gazette's
 * deceased-estates and personal-insolvency notices — already produces its own
 * shape. This is the join that was missing: one typed `SourcedLead` the sourcing
 * surface renders, so "we can find motivated sellers from licensed registers"
 * stops being a claim in a table and becomes something reachable from a page.
 *
 * What this is NOT, deliberately: it finds, it does not contact. There is no
 * address here, no automated follow-up, no outreach of any kind. Every lead
 * carries the lawful next step a *named person* must take — confirm the owner on
 * the title, screen against the MPS, record a legitimate-interests assessment,
 * approach by letter. The automated-outreach version of this is a PECR breach
 * aimed at exactly the people Seller Protection exists for, and it is absent on
 * purpose.
 */

/** The lawful next step for each signal, in one place rather than per lead. */
const NEXT_STEP: Record<LeadSignal, string> = {
  "prepared-but-unsold":
    "Approach by post only. Either write to 'The Homeowner' at the property now — no name held, with a privacy notice and a one-line opt-out — or confirm the registered owner on the title (lookupOwner — deal id, purpose and a named requester) for a named approach. There is no electronic contact to an individual without consent.",
  "probate-notice":
    "Heightened protection. The executors are approached by letter only, with MPS screening and a recorded legitimate-interests assessment; the notice's own contact for service is the lawful route. A named person decides — nothing is automated.",
  "owner-insolvent":
    "Heightened protection. Confirm a current entry on the Individual Insolvency Register (confirmInsolvency) before anything; approach by letter only under heightened care. Internal analysis only — never shown to a buyer or put on a card.",
  "negative-equity":
    "An estimate, not a valuation — the figure comes from the local median price per square metre, which is a proxy. Where the owner may owe more than the property is worth, a lease option or assisted sale is sometimes the only route that works. Confirm the value and the outstanding balance before any approach; letter only.",
};

const LABEL: Record<LeadSignal, string> = {
  "prepared-but-unsold": "Prepared for sale, never sold",
  "probate-notice": "Probate (deceased estate)",
  "owner-insolvent": "Owner in insolvency",
  "negative-equity": "Possible negative equity",
};

export interface SourcingInputs {
  readonly preparedButUnsold?: readonly PropertyCandidate[];
  readonly deceasedEstates?: readonly DeceasedEstateNotice[];
  readonly insolvencies?: readonly InsolvencyNotice[];
  /** Negative-equity leads, already computed from an estimated value. */
  readonly negativeEquity?: readonly SourcedLead[];
}

/**
 * Join the adapter outputs into one ranked list of leads.
 *
 * Pure: it takes already-parsed inputs and produces leads, so it is testable
 * without a network and without a dataset on disk. Strong leads first, and
 * within that the heightened-protection ones are not pushed up the queue —
 * urgency is never a reason to hurry an approach to a grieving or insolvent
 * person.
 */
export function sourceProperties(
  inputs: SourcingInputs,
  now: Date = new Date(),
  priorityAreas: readonly string[] = DEFAULT_PRIORITY_AREAS,
): readonly SourcedLead[] {
  const observedAt = now.toISOString().slice(0, 10);
  const leads: SourcedLead[] = [];
  // The sender particulars for any probate letter drafted below. Read once.
  const sender = companyIdentity(process.env);

  for (const candidate of inputs.preparedButUnsold ?? []) {
    // The house number and street, so the card names a property rather than a
    // postcode. This is a property fact from the EPC register, not data about a
    // person, and the surface is operator-only.
    const address = `${candidate.paon} ${candidate.street}`.replace(/\s+/g, " ").trim();
    leads.push({
      signalKey: "prepared-but-unsold",
      label: LABEL["prepared-but-unsold"],
      addressKey: candidate.addressKey,
      postcode: candidate.postcode,
      summary: candidate.reason,
      strength: candidate.strength,
      heightenedProtection: false,
      provenance: attribute(EPC_SOURCE, candidate.preparedAt),
      lawfulNextStep: NEXT_STEP["prepared-but-unsold"],
      // The homeowner letter needs an address, not a name — so it is drafted now,
      // to "The Homeowner" at the property, and the operator can post it without
      // waiting on a title lookup. Only when there is an address to write to.
      ...(address !== ""
        ? {
            propertyAddress: address,
            letterDraft: draftHomeownerLetter({
              sender,
              propertyAddress: address,
              ...(candidate.postcode !== "" ? { postcode: candidate.postcode } : {}),
              today: observedAt,
            }),
          }
        : {}),
    });
  }

  for (const notice of inputs.deceasedEstates ?? []) {
    const located = notice.postcode !== undefined;
    leads.push({
      signalKey: "probate-notice",
      label: LABEL["probate-notice"],
      ...(notice.postcode !== undefined ? { postcode: notice.postcode } : {}),
      summary: `A deceased-estates notice names ${notice.deceasedName}${
        notice.lastAddress !== undefined ? ` of ${notice.lastAddress}` : ""
      }${notice.dateOfDeath !== undefined ? `, who died ${notice.dateOfDeath}` : ""}. Placed before an estate distributes, it precedes a sale by executors.`,
      // A notice with an address located to a property is strong; one without is
      // worth a look but needs the property identified first.
      strength: located ? "strong" : "worth-a-look",
      heightenedProtection: true,
      provenance: attribute(GAZETTE_SOURCE, observedAt),
      lawfulNextStep: NEXT_STEP["probate-notice"],
      ...(notice.contactForService !== undefined ? { contactForService: notice.contactForService } : {}),
      ...(notice.noticeUrl !== undefined ? { sourceUrl: notice.noticeUrl } : {}),
      ...(notice.lastAddress !== undefined ? { propertyAddress: notice.lastAddress } : {}),
      subjectName: notice.deceasedName,
      letterDraft: draftProbateLetter({
        sender,
        ...(notice.contactForService !== undefined ? { recipientContact: notice.contactForService } : {}),
        deceasedName: notice.deceasedName,
        ...(notice.lastAddress !== undefined ? { propertyAddress: notice.lastAddress } : {}),
        ...(notice.claimDeadline !== undefined ? { claimDeadline: notice.claimDeadline } : {}),
        today: observedAt,
      }),
    });
  }

  for (const notice of inputs.insolvencies ?? []) {
    const located = notice.postcode !== undefined;
    // Only a bankruptcy order vests the debtor's home in a trustee (the Official
    // Receiver until one is appointed), who alone may sell it — so only then is
    // there a lawful office-holder to write to. An IVA or DRO leaves the debtor
    // owning the property, so there is no letter: the recipient would be the
    // vulnerable individual the protections exist for, which is exactly what we
    // refuse to do.
    const writesToTrustee = notice.noticeType === "bankruptcy-order";
    leads.push({
      signalKey: "owner-insolvent",
      label: LABEL["owner-insolvent"],
      ...(notice.postcode !== undefined ? { postcode: notice.postcode } : {}),
      summary: `A ${notice.noticeType.replace(/-/g, " ")} notice names ${notice.debtorName}${
        notice.lastAddress !== undefined ? ` of ${notice.lastAddress}` : ""
      }. The root cause behind many repossessions, in the record before a lender lists.`,
      strength: located ? "strong" : "worth-a-look",
      heightenedProtection: true,
      provenance: attribute(INSOLVENCY_SOURCE, observedAt),
      lawfulNextStep: NEXT_STEP["owner-insolvent"],
      ...(notice.noticeUrl !== undefined ? { sourceUrl: notice.noticeUrl } : {}),
      ...(notice.lastAddress !== undefined ? { propertyAddress: notice.lastAddress } : {}),
      ...(notice.contactForService !== undefined ? { contactForService: notice.contactForService } : {}),
      subjectName: notice.debtorName,
      ...(writesToTrustee
        ? {
            letterDraft: draftInsolvencyLetter({
              sender,
              ...(notice.contactForService !== undefined ? { officeHolder: notice.contactForService } : {}),
              debtorName: notice.debtorName,
              ...(notice.lastAddress !== undefined ? { propertyAddress: notice.lastAddress } : {}),
              today: observedAt,
            }),
          }
        : {}),
    });
  }

  // Negative-equity leads arrive already computed (they need an estimated value
  // the caller derives), so they are passed straight through here.
  for (const lead of inputs.negativeEquity ?? []) leads.push(lead);

  // Priority area first (the operator's target region — the Gazette feed is
  // national, so without this the priority leads scroll off), then strong first,
  // then a stable order within each tier so a rerun reads the same. Area is a
  // where-we-work sort, not an urgency sort: it never hurries an approach to a
  // grieving or insolvent person, it only surfaces the region Lode operates in.
  const priorityRank = (l: SourcedLead): number =>
    l.postcode !== undefined && isPriorityArea(l.postcode, priorityAreas) ? 0 : 1;
  const strengthRank = (l: SourcedLead): number => (l.strength === "strong" ? 0 : 1);
  return leads.sort((a, b) => priorityRank(a) - priorityRank(b) || strengthRank(a) - strengthRank(b));
}

/* ------------------------------------------------------- source readiness */

/**
 * What each source needs before it can produce a lead — computed cheaply, with
 * no outbound request, so the surface can state the position without a run.
 */
export function sourcingReadiness(
  env: { readonly epcKey?: string; readonly gazetteDeceasedCode?: string; readonly gazetteInsolvencyCode?: string } = {},
): readonly SourceReadiness[] {
  const named = (key: string): string => getSource(key)?.name ?? key;
  const gazetteConfigured =
    (env.gazetteDeceasedCode ?? "") !== "" || (env.gazetteInsolvencyCode ?? "") !== "";

  return [
    {
      sourceKey: PPD_SOURCE,
      name: named(PPD_SOURCE),
      state: "ready",
      detail:
        "Open Government Licence, free, no key. Queried per postcode over the Land Registry linked-data endpoint (fetchSales) and joined to the EPC register by findCandidates — no bulk file to download.",
    },
    {
      sourceKey: EPC_SOURCE,
      name: named(EPC_SOURCE),
      state: (env.epcKey ?? "") === "" ? "needs-credential" : "ready",
      detail:
        (env.epcKey ?? "") === ""
          ? "Free with registration. Set EPC_API_EMAIL and EPC_API_KEY for the per-postcode live pull (fetchCertificates). Until then the area search returns the Price Paid half only."
          : "Credential present. Certificates are pulled per postcode (fetchCertificates) and joined to Price Paid by findCandidates.",
    },
    {
      sourceKey: GAZETTE_SOURCE,
      name: named(GAZETTE_SOURCE),
      state: gazetteConfigured ? "ready" : "needs-credential",
      detail: gazetteConfigured
        ? "Open Government Licence, free API, no key. Deceased-estates and insolvency notices are fetched through the Fetcher and parsed at source."
        : "Open Government Licence, free API. Set the deceased-estates and insolvency notice codes (GAZETTE_DECEASED_CODE / GAZETTE_INSOLVENCY_CODE) to run it; confirm the codes against the live API first.",
    },
    {
      sourceKey: INSOLVENCY_SOURCE,
      name: named(INSOLVENCY_SOURCE),
      state: "needs-arrangement",
      detail:
        "Internal analysis only. No open REST API: confirmation is via a data-access arrangement with the Insolvency Service. parseInsolvencyRegisterRecord and confirmInsolvency are ready for when it is in place.",
    },
  ];
}

/* ------------------------------------------- run: from a dataset on hand */

export interface DatasetRunResult {
  readonly leads: readonly SourcedLead[];
  /** Completed nearby refurbishments — market evidence, shown apart from leads. */
  readonly flips: readonly FlipEvidence[];
  readonly epcConsidered: number;
  readonly salesConsidered: number;
  readonly skipped: number;
  readonly note: string;
}

/**
 * Everything the two licensed datasets yield: leads and market evidence.
 *
 * The lawful, offline path — the operator downloads the licensed open datasets
 * (both OGL / free-with-registration) and this joins them. No outbound request
 * is made, so it works where egress is blocked and, more importantly, it is the
 * ordinary way these bulk files are obtained: by downloading them, not by
 * hammering an API per address.
 *
 * Three of the register signals come out of here. `findCandidates` gives
 * prepared-but-unsold; `findFlips` gives the finished values nearby; and where a
 * candidate has a floor area and a prior sale, the local median price per square
 * metre gives an *estimated* current value, and `negativeEquity` flags the ones
 * that may be underwater. The negative-equity figure is an estimate and is
 * labelled as one — it is never presented as a valuation.
 */
export function runFromDatasets(ppdCsv: string, epcCsv: string, now: Date = new Date()): DatasetRunResult {
  const { records: sales, skipped: ppdSkipped } = parsePricePaid(ppdCsv);
  const { records: epc, skipped: epcSkipped } = parseEpc(epcCsv);
  const { leads, flips, found } = joinToLeads(epc, sales, now);

  return {
    leads,
    flips,
    epcConsidered: found.considered,
    salesConsidered: sales.length,
    skipped: ppdSkipped + epcSkipped,
    note:
      found.candidates.length === 0
        ? `No prepared-but-unsold candidates. ${found.soldSince} sold since their certificate, ${found.tooRecent} too recent, ${found.tooOld} too old to act on.`
        : `${found.candidates.length} candidate(s): a certificate lodged, no sale registered since. ${found.soldSince} sold since, ${found.tooRecent} too recent, ${found.tooOld} too old.`,
  };
}

/**
 * The join itself, independent of where the two datasets came from.
 *
 * Shared by the bulk-file path (runFromDatasets) and the area path
 * (runFromArea) so the prepared-but-unsold, negative-equity and flip logic is
 * defined once and reads the same whether the records arrived as a pasted CSV
 * or from a per-postcode API call. Pure: records in, leads out.
 */
/**
 * Collapse repeated certificates for one address to a single candidate.
 *
 * A property re-certified over the years (a new EPC for a remortgage, a let, a
 * relisting) yields one candidate per certificate — the same house ten times on
 * the worklist. Keep the most recently lodged, which is the current "prepared"
 * state, and preserve the longest-prepared-first order.
 */
function dedupeByAddress(candidates: readonly PropertyCandidate[]): readonly PropertyCandidate[] {
  const byKey = new Map<string, PropertyCandidate>();
  for (const c of candidates) {
    const held = byKey.get(c.addressKey);
    if (held === undefined || c.preparedAt > held.preparedAt) byKey.set(c.addressKey, c);
  }
  return [...byKey.values()].sort((a, b) => b.monthsSincePrepared - a.monthsSincePrepared);
}

function joinToLeads(
  epc: readonly EpcRecord[],
  sales: readonly PricePaidRecord[],
  now: Date,
): { readonly leads: readonly SourcedLead[]; readonly flips: readonly FlipEvidence[]; readonly found: CandidateSearch } {
  const raw = findCandidates(epc, sales, now);
  // One row per address, not one per certificate.
  const found: CandidateSearch = { ...raw, candidates: dedupeByAddress(raw.candidates) };

  // Floor area by address, from the EPC side, for the £/sqm estimate.
  const floorAreaByAddress = new Map<string, number>();
  for (const certificate of epc) {
    if (certificate.floorAreaSqm !== undefined && certificate.floorAreaSqm > 0) {
      floorAreaByAddress.set(addressKey(certificate), certificate.floorAreaSqm);
    }
  }
  const medianRate = medianPricePerSqm(sales, floorAreaByAddress);

  // Negative equity: a candidate whose estimated value sits below what was last
  // paid. Only where we have both a prior price and a floor area to estimate on.
  const negativeEquityLeads: SourcedLead[] = [];
  if (medianRate !== undefined) {
    for (const candidate of found.candidates) {
      const area = floorAreaByAddress.get(candidate.addressKey);
      if (area === undefined || candidate.lastSoldPrice === undefined) continue;
      const flag = negativeEquity(candidate.lastSoldPrice, money(Math.round(medianRate * area)));
      if (flag === undefined) continue;
      negativeEquityLeads.push({
        signalKey: "negative-equity",
        label: LABEL["negative-equity"],
        addressKey: candidate.addressKey,
        postcode: candidate.postcode,
        summary: `Last sold for more than an estimate of today's value (roughly ${Math.round(flag.shortfallBps / 100)}% above). The estimate is the local median price per square metre — a proxy, not a valuation.`,
        strength: "worth-a-look",
        heightenedProtection: false,
        provenance: attribute(PPD_SOURCE, now.toISOString().slice(0, 10)),
        lawfulNextStep: NEXT_STEP["negative-equity"],
      });
    }
  }

  const leads = sourceProperties(
    { preparedButUnsold: found.candidates, negativeEquity: negativeEquityLeads },
    now,
  );

  const flips: FlipEvidence[] = findFlips(sales).map((flip) => ({
    addressKey: flip.addressKey,
    postcode: flip.postcode,
    boughtAt: flip.boughtAt,
    boughtFor: flip.boughtFor,
    soldAt: flip.soldAt,
    soldFor: flip.soldFor,
    monthsHeld: flip.monthsHeld,
    upliftBps: flip.upliftBps,
  }));

  return { leads, flips, found };
}

/* ----------------------------------------- run: an area, from the APIs */

export interface AreaRunResult {
  readonly leads: readonly SourcedLead[];
  readonly flips: readonly FlipEvidence[];
  readonly certificates: number;
  readonly sales: number;
  readonly notes: readonly string[];
  readonly note: string;
}

/** One EPC certificate from the API, reduced to the join's record shape. */
function toEpcRecord(c: EpcCertificate): EpcRecord {
  const { paon, street } = splitAddressLine(c.addressLine1);
  return {
    postcode: c.postcode,
    paon,
    // The API folds any secondary name into the address line; there is no
    // separate SAON field, so the key is built from PAON and street.
    saon: "",
    street,
    lodgedAt: c.lodgedAt,
    rating: c.rating ?? "",
    ...(c.floorAreaSqm !== undefined ? { floorAreaSqm: c.floorAreaSqm } : {}),
    ...(c.constructionAgeBand !== undefined ? { constructionAgeBand: c.constructionAgeBand } : {}),
  };
}

/**
 * Find prepared-but-unsold candidates for one postcode, from the live APIs.
 *
 * This is the path that replaced the dataset paste box. The bulk Price Paid file
 * is gigabytes and cannot be pasted into a browser, so the operator never had a
 * realistic way to run the prepared-but-unsold join. Instead this queries the
 * EPC register (credentialed) and the Land Registry Price Paid endpoint (open,
 * no key) for a single postcode and runs the identical join — no file, no paste.
 *
 * Each source is tried independently and its failure is caught and noted: an
 * unset EPC credential, or an endpoint unreachable from this host, degrades to a
 * note and zero leads rather than a blank page. It never invents a lead to fill
 * the space.
 */
export async function runFromArea(
  postcode: string,
  deps: {
    readonly epc?: (pc: string) => Promise<readonly EpcCertificate[]>;
    readonly sales?: (pc: string) => Promise<readonly PricePaidRecord[]>;
    readonly now?: Date;
  } = {},
): Promise<AreaRunResult> {
  const now = deps.now ?? new Date();
  const epcFetch = deps.epc ?? ((p: string) => fetchCertificates(p));
  const salesFetch = deps.sales ?? ((p: string) => fetchSales(p));
  const notes: string[] = [];
  const pc = postcode.toUpperCase().trim();

  let certs: readonly EpcCertificate[] = [];
  try {
    certs = await epcFetch(pc);
    notes.push(`EPC register: ${certs.length} certificate(s) in ${pc}.`);
  } catch (error) {
    notes.push(`EPC register: ${messageOf(error)}`);
  }

  let sales: readonly PricePaidRecord[] = [];
  try {
    sales = await salesFetch(pc);
    notes.push(`Price Paid: ${sales.length} registered sale(s) in ${pc}.`);
  } catch (error) {
    notes.push(`Price Paid: ${messageOf(error)}`);
  }

  const { leads, flips, found } = joinToLeads(certs.map(toEpcRecord), sales, now);

  return {
    leads,
    flips,
    certificates: certs.length,
    sales: sales.length,
    notes,
    note:
      found.candidates.length === 0
        ? `No prepared-but-unsold candidates in ${pc}. ${found.soldSince} sold since their certificate, ${found.tooRecent} too recent, ${found.tooOld} too old to act on.`
        : `${found.candidates.length} candidate(s) in ${pc}: a certificate lodged, no sale registered since. ${found.soldSince} sold since, ${found.tooRecent} too recent, ${found.tooOld} too old.`,
  };
}

/* ------------------------------------------- run: a council / city */

/** Run `fn` over items with at most `limit` in flight, preserving order. */
async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker));
  return results;
}

export interface CouncilRunConfig {
  /** One page of certificates for the council; injected in tests. */
  readonly epc?: (page: number) => Promise<{ readonly certificates: readonly EpcCertificate[]; readonly nextPage: number | null }>;
  readonly sales?: (postcode: string) => Promise<readonly PricePaidRecord[]>;
  readonly now?: Date;
  /** Hard cap on EPC pages read (each up to 5,000 certificates). */
  readonly maxCertPages?: number;
  /** Hard cap on how many distinct postcodes are checked against Price Paid. */
  readonly maxPostcodes?: number;
  /** How many Price Paid lookups run at once. */
  readonly concurrency?: number;
}

/**
 * Find prepared-but-unsold candidates across a whole council / city.
 *
 * The wider sweep the single-postcode search could not do. EPC supports a
 * `council[]` filter and pagination, so the certificates come from there in a
 * bounded number of pages; the actionable age window (older than the minimum,
 * no older than three years) is applied at source, which both pre-excludes
 * certificates too recent to mean anything and keeps the volume sane.
 *
 * Price Paid has no council filter, so it is queried per postcode — the
 * confirmed path — for the distinct postcodes the certificates name, throttled
 * and capped. Correctness turns on coverage: a certificate is only judged where
 * its postcode's Price Paid lookup actually succeeded, because a missing sale
 * history would make every certificate there look "no sale since" — a false
 * candidate. Uncovered certificates are excluded with a note, never guessed.
 */
export async function runFromCouncil(council: string, deps: CouncilRunConfig = {}): Promise<AreaRunResult> {
  const now = deps.now ?? new Date();
  const maxCertPages = deps.maxCertPages ?? 4;
  const maxPostcodes = deps.maxPostcodes ?? 50;
  const concurrency = deps.concurrency ?? 6;
  const name = council.trim();
  const notes: string[] = [];

  const monthsAgo = (m: number): string => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - m);
    return d.toISOString().slice(0, 10);
  };
  // Older than the minimum (so a sale mid-completion is not a false lead) and
  // no older than three years (beyond which the signal is stale).
  const dateEnd = monthsAgo(MINIMUM_MONTHS);
  const dateStart = monthsAgo(36);

  const epcPage =
    deps.epc ??
    ((page: number) => searchCertificates({ council: [name], date_start: dateStart, date_end: dateEnd }, { page }));

  const certs: EpcCertificate[] = [];
  try {
    for (let page = 1; page <= maxCertPages; page += 1) {
      const res = await epcPage(page);
      certs.push(...res.certificates);
      if (res.nextPage === null) break;
      if (page === maxCertPages) {
        notes.push(`EPC: stopped at ${maxCertPages} pages — narrow to a postcode district for the rest.`);
      }
    }
    notes.push(`EPC register: ${certs.length} certificate(s) in ${name}, lodged ${dateStart} to ${dateEnd}.`);
  } catch (error) {
    notes.push(`EPC register: ${messageOf(error)}`);
  }

  // Distinct postcodes, capped. Price Paid is queried per postcode, so the
  // fan-out is bounded to what the certificates actually name.
  const postcodes = [...new Set(certs.map((c) => c.postcode).filter((p) => p !== ""))];
  const queried = postcodes.slice(0, maxPostcodes);
  if (postcodes.length > queried.length) {
    notes.push(
      `${postcodes.length} postcodes found; checked the first ${queried.length} against Price Paid — narrow the area for the rest.`,
    );
  }

  const salesFetch = deps.sales ?? ((p: string) => fetchSales(p));
  const outcomes = await mapPool(queried, concurrency, async (pc) => {
    try {
      return { pc, rows: await salesFetch(pc) };
    } catch {
      return { pc, rows: undefined as readonly PricePaidRecord[] | undefined };
    }
  });

  const covered = new Set<string>();
  const sales: PricePaidRecord[] = [];
  let failed = 0;
  for (const o of outcomes) {
    if (o.rows === undefined) {
      failed += 1;
      continue;
    }
    covered.add(o.pc);
    sales.push(...o.rows);
  }
  notes.push(
    `Price Paid: queried ${queried.length} postcode(s)${failed > 0 ? `, ${failed} failed` : ""}, ${sales.length} sale(s).`,
  );

  // Only judge certificates whose postcode has confirmed sale coverage.
  const certsCovered = certs.filter((c) => covered.has(c.postcode));
  const { leads, flips, found } = joinToLeads(certsCovered.map(toEpcRecord), sales, now);

  return {
    leads,
    flips,
    certificates: certsCovered.length,
    sales: sales.length,
    notes,
    note:
      found.candidates.length === 0
        ? `No prepared-but-unsold candidates in ${name} from ${certsCovered.length} checked certificate(s). ${found.soldSince} sold since, ${found.tooRecent} too recent, ${found.tooOld} too old.`
        : `${found.candidates.length} candidate(s) in ${name}: a certificate lodged, no sale registered since. ${found.soldSince} sold since, ${found.tooRecent} too recent, ${found.tooOld} too old.`,
  };
}

/* ----------------------------------------- run: the public registers */

export interface RegisterRunConfig {
  readonly deceasedCode?: string;
  readonly insolvencyCode?: string;
  readonly start?: string;
  readonly end?: string;
  /** How many leads to gather per kind, paging the feed as needed. */
  readonly maxNotices?: number;
}

export interface RegisterRunResult {
  readonly leads: readonly SourcedLead[];
  readonly notes: readonly string[];
  readonly requestsMade: number;
}

/**
 * Fetch the Gazette's deceased-estates and insolvency notices and turn them
 * into leads.
 *
 * Every request goes through the Fetcher, so the licence, host, robots and
 * rate-limit gates apply and a refusal is final. Where egress is blocked the
 * feed fetch simply fails closed and the reason is reported — the surface shows
 * why nothing came back rather than inventing a lead to fill the space.
 */
export async function runRegisters(
  config: RegisterRunConfig,
  options: { readonly fetcher?: Fetcher; readonly now?: Date } = {},
): Promise<RegisterRunResult> {
  const fetcher = options.fetcher ?? new Fetcher();
  const now = options.now ?? new Date();
  const notes: string[] = [];
  const deceased: DeceasedEstateNotice[] = [];
  const insolvencies: InsolvencyNotice[] = [];
  const cap = config.maxNotices ?? 50;
  // The feed's own page-size ceiling; one request returns this many at most.
  const pageSize = Math.min(Math.max(cap, 1), 50);

  const sweep = async (
    code: string | undefined,
    kind: "deceased" | "insolvency",
  ): Promise<void> => {
    if (code === undefined || code === "") {
      notes.push(`${kind}: no notice code configured, so nothing was fetched.`);
      return;
    }

    let parsed = 0;
    let located = 0;
    let listed = 0;
    // The feed can list the same notice twice — an amendment, or a repeat
    // across a page boundary — and a worklist that shows the same person twice
    // is noise on exactly the leads that demand care. Deduped by notice id.
    const seen = new Set<string>();

    // Page through the feed until we have the requested number of leads, the
    // feed runs out, or a hard bound on requests is reached. The entry carries
    // the name and address, so no per-notice request is made — only the page
    // reads, each gated by the Fetcher.
    for (let page = 1; parsed < cap && page <= 20; page += 1) {
      const feed = await fetchNotices(fetcher, {
        noticeCode: code,
        pageSize,
        page,
        ...(config.start !== undefined ? { start: config.start } : {}),
        ...(config.end !== undefined ? { end: config.end } : {}),
      });
      if (!feed.ok || feed.value === undefined) {
        if (page === 1) notes.push(`${kind}: ${feed.reason}`);
        break;
      }
      if (feed.value.length === 0) break;
      listed += feed.value.length;

      for (const notice of feed.value) {
        if (parsed >= cap) break;
        if (kind === "deceased") {
          const record = parseDeceasedEstate(notice);
          if (record !== undefined && !seen.has(record.noticeId)) {
            seen.add(record.noticeId);
            deceased.push(record);
            parsed += 1;
            if (record.postcode !== undefined) located += 1;
          }
        } else {
          const record = parseInsolvencyNotice(notice);
          if (record !== undefined && !seen.has(record.noticeId)) {
            seen.add(record.noticeId);
            insolvencies.push(record);
            parsed += 1;
            if (record.postcode !== undefined) located += 1;
          }
        }
      }

      // A short page is the last page.
      if (feed.value.length < pageSize) break;
    }

    notes.push(
      `${kind}: ${listed} listed → ${parsed} parsed into leads → ${located} with a postcode.`,
    );
  };

  await sweep(config.deceasedCode, "deceased");
  await sweep(config.insolvencyCode, "insolvency");

  // The contact for service is resolved on demand — one fetch when the operator
  // opens a lead's letter — rather than in bulk here. That keeps the run to the
  // feed pages (fast, even at a hundred leads) and means every lead can resolve
  // its contact, not just a capped first slice. See resolveLetter in the
  // sourcing actions.
  // Priority areas float to the top of the national register run — the default
  // West & East Midlands, or a GAZETTE_PRIORITY_AREAS override.
  const priorityAreas = parsePriorityAreas(process.env.GAZETTE_PRIORITY_AREAS) ?? DEFAULT_PRIORITY_AREAS;
  return {
    leads: sourceProperties({ deceasedEstates: deceased, insolvencies }, now, priorityAreas),
    notes,
    requestsMade: fetcher.requestsMade,
  };
}

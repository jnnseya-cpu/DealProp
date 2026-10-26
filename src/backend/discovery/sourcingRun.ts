import { money } from "@shared/money";
import { attribute, getSource } from "@shared/domain/sources";
import { companyIdentity } from "@shared/domain/identity";
import { draftProbateLetter } from "@shared/domain/probateLetter";
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
  type EpcRecord,
  type PropertyCandidate,
} from "@backend/discovery/properties";
import {
  GAZETTE_SOURCE,
  fetchNoticeDetail,
  fetchNotices,
  parseDeceasedEstate,
  parseInsolvencyNotice,
  type DeceasedEstateNotice,
  type InsolvencyNotice,
} from "@backend/discovery/gazette";
import { INSOLVENCY_SOURCE } from "@backend/discovery/insolvencyRegister";
import { Fetcher } from "@backend/discovery/fetcher";

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
    "Confirm the registered owner on the title (lookupOwner — deal id, purpose and a named requester) before any approach. A named individual is written to by post only; there is no electronic contact without consent.",
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
export function sourceProperties(inputs: SourcingInputs, now: Date = new Date()): readonly SourcedLead[] {
  const observedAt = now.toISOString().slice(0, 10);
  const leads: SourcedLead[] = [];
  // The sender particulars for any probate letter drafted below. Read once.
  const sender = companyIdentity(process.env);

  for (const candidate of inputs.preparedButUnsold ?? []) {
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
    });
  }

  // Negative-equity leads arrive already computed (they need an estimated value
  // the caller derives), so they are passed straight through here.
  for (const lead of inputs.negativeEquity ?? []) leads.push(lead);

  // Strong first; a stable order within each tier so a rerun reads the same.
  return leads.sort((a, b) => (a.strength === b.strength ? 0 : a.strength === "strong" ? -1 : 1));
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
      state: "needs-dataset",
      detail:
        "Open Government Licence, free. Provide the Price Paid CSV (the monthly bulk file) to compute prepared-but-unsold and flips. Parsed by parsePricePaid; joined by findCandidates.",
    },
    {
      sourceKey: EPC_SOURCE,
      name: named(EPC_SOURCE),
      state: (env.epcKey ?? "") === "" ? "needs-credential" : "ready",
      detail:
        (env.epcKey ?? "") === ""
          ? "Free with registration. Provide the EPC bulk CSV, or set EPC_API_EMAIL/EPC_API_KEY for a live pull. Parsed by parseEpc."
          : "Credential present. The EPC bulk CSV is parsed by parseEpc and joined to Price Paid by findCandidates.",
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
  const found = findCandidates(epc, sales, now);

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

  return {
    leads,
    flips,
    epcConsidered: found.considered,
    salesConsidered: sales.length,
    skipped: ppdSkipped + epcSkipped,
    note:
      found.candidates.length === 0
        ? `No prepared-but-unsold candidates. ${found.soldSince} sold since their certificate, ${found.tooRecent} too recent to mean anything yet.`
        : `${found.candidates.length} candidate(s): a certificate lodged, no sale registered since. ${found.soldSince} sold since, ${found.tooRecent} too recent.`,
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
  /** How many probate leads to look up a contact for service for. */
  readonly maxContacts?: number;
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

  // Enrich a bounded number of probate leads with the contact for service, so
  // the operator has who to lawfully write to inside Lode rather than leaving
  // to read the notice. Each is a fetch of the notice's own page, so it is
  // capped; the rest still carry the notice link.
  const contactCap = config.maxContacts ?? 20;
  const enrichedDeceased: DeceasedEstateNotice[] = [];
  let contactsFetched = 0;
  let contactsFound = 0;
  for (const record of deceased) {
    if (contactsFetched < contactCap && record.noticeUrl !== undefined) {
      contactsFetched += 1;
      const detail = await fetchNoticeDetail(fetcher, record.noticeUrl);
      if (detail.ok && detail.value !== undefined) {
        if (detail.value.contactForService !== undefined) contactsFound += 1;
        enrichedDeceased.push({
          ...record,
          ...(detail.value.contactForService !== undefined
            ? { contactForService: detail.value.contactForService }
            : {}),
          ...(detail.value.claimDeadline !== undefined
            ? { claimDeadline: detail.value.claimDeadline }
            : {}),
        });
        continue;
      }
    }
    enrichedDeceased.push(record);
  }
  if (contactsFetched > 0) {
    notes.push(`contacts: ${contactsFound} of ${contactsFetched} probate notice(s) named a contact for service.`);
  }

  return {
    leads: sourceProperties({ deceasedEstates: enrichedDeceased, insolvencies }, now),
    notes,
    requestsMade: fetcher.requestsMade,
  };
}

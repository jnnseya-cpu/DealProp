import { attribute, getSource, type SourceAttribution } from "@shared/domain/sources";
import {
  EPC_SOURCE,
  PPD_SOURCE,
  findCandidates,
  parseEpc,
  parsePricePaid,
  type PropertyCandidate,
} from "@backend/discovery/properties";
import {
  GAZETTE_SOURCE,
  fetchNotice,
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

export type LeadSignal = "prepared-but-unsold" | "probate-notice" | "owner-insolvent";

export interface SourcedLead {
  readonly signalKey: LeadSignal;
  readonly label: string;
  /** A normalised address key for the property, where one is known. */
  readonly addressKey?: string;
  readonly postcode?: string;
  /** What is known, stated plainly. Never a bare score. */
  readonly summary: string;
  readonly strength: "strong" | "worth-a-look";
  /**
   * True where the signal is itself a sign of vulnerability. It raises the bar
   * to contact, never lowers it: a distress lead routes to the heightened-care,
   * letter-only path, not to a faster pursuit.
   */
  readonly heightenedProtection: boolean;
  readonly provenance: SourceAttribution;
  /** The lawful next step a named person takes. Never "send". */
  readonly lawfulNextStep: string;
}

/** The lawful next step for each signal, in one place rather than per lead. */
const NEXT_STEP: Record<LeadSignal, string> = {
  "prepared-but-unsold":
    "Confirm the registered owner on the title (lookupOwner — deal id, purpose and a named requester) before any approach. A named individual is written to by post only; there is no electronic contact without consent.",
  "probate-notice":
    "Heightened protection. The executors are approached by letter only, with MPS screening and a recorded legitimate-interests assessment; the notice's own contact for service is the lawful route. A named person decides — nothing is automated.",
  "owner-insolvent":
    "Heightened protection. Confirm a current entry on the Individual Insolvency Register (confirmInsolvency) before anything; approach by letter only under heightened care. Internal analysis only — never shown to a buyer or put on a card.",
};

const LABEL: Record<LeadSignal, string> = {
  "prepared-but-unsold": "Prepared for sale, never sold",
  "probate-notice": "Probate (deceased estate)",
  "owner-insolvent": "Owner in insolvency",
};

export interface SourcingInputs {
  readonly preparedButUnsold?: readonly PropertyCandidate[];
  readonly deceasedEstates?: readonly DeceasedEstateNotice[];
  readonly insolvencies?: readonly InsolvencyNotice[];
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
    });
  }

  // Strong first; a stable order within each tier so a rerun reads the same.
  return leads.sort((a, b) => (a.strength === b.strength ? 0 : a.strength === "strong" ? -1 : 1));
}

/* ------------------------------------------------------- source readiness */

export type ReadinessState = "ready" | "needs-dataset" | "needs-credential" | "needs-arrangement";

export interface SourceReadiness {
  readonly sourceKey: string;
  readonly name: string;
  readonly state: ReadinessState;
  readonly detail: string;
}

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
  readonly epcConsidered: number;
  readonly salesConsidered: number;
  readonly skipped: number;
  readonly note: string;
}

/**
 * Compute prepared-but-unsold leads from datasets the operator already holds.
 *
 * The lawful, offline path: the operator downloads the licensed open datasets
 * (both OGL / free-with-registration) and this joins them. No outbound request
 * is made, so it works where egress is blocked and, more importantly, it is the
 * ordinary way these bulk files are obtained — by downloading them, not by
 * hammering an API per address.
 */
export function runFromDatasets(ppdCsv: string, epcCsv: string, now: Date = new Date()): DatasetRunResult {
  const { records: sales, skipped: ppdSkipped } = parsePricePaid(ppdCsv);
  const { records: epc, skipped: epcSkipped } = parseEpc(epcCsv);
  const found = findCandidates(epc, sales, now);
  const leads = sourceProperties({ preparedButUnsold: found.candidates }, now);

  return {
    leads,
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
  /** Cap on per-notice body reads, kept well inside the Fetcher's run budget. */
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
  const cap = config.maxNotices ?? 20;

  const sweep = async (
    code: string | undefined,
    kind: "deceased" | "insolvency",
  ): Promise<void> => {
    if (code === undefined || code === "") {
      notes.push(`${kind}: no notice code configured, so nothing was fetched.`);
      return;
    }
    const feed = await fetchNotices(fetcher, {
      noticeCode: code,
      ...(config.start !== undefined ? { start: config.start } : {}),
      ...(config.end !== undefined ? { end: config.end } : {}),
    });
    if (!feed.ok || feed.value === undefined) {
      notes.push(`${kind}: ${feed.reason}`);
      return;
    }
    notes.push(`${kind}: ${feed.value.length} notice(s) listed.`);

    for (const notice of feed.value.slice(0, cap)) {
      if (notice.noticeUrl === undefined) continue;
      const body = await fetchNotice(fetcher, notice.noticeUrl);
      if (!body.ok) continue;
      if (kind === "deceased") {
        const parsed = parseDeceasedEstate(body.value);
        if (parsed !== undefined) deceased.push(parsed);
      } else {
        const parsed = parseInsolvencyNotice(body.value);
        if (parsed !== undefined) insolvencies.push(parsed);
      }
    }
  };

  await sweep(config.deceasedCode, "deceased");
  await sweep(config.insolvencyCode, "insolvency");

  return {
    leads: sourceProperties({ deceasedEstates: deceased, insolvencies }, now),
    notes,
    requestsMade: fetcher.requestsMade,
  };
}

import type { Money } from "@shared/money";
import type { SourceAttribution } from "@shared/domain/sources";

/**
 * The shapes the property-sourcing surface renders.
 *
 * These live in `shared` rather than beside the orchestration in `backend`
 * because they are pure data a client component displays, and a client
 * component may not import `@backend` even for a type — the boundary test
 * forbids it, since a single backend import pulls the store and the driver into
 * the browser bundle. The functions that *produce* these shapes stay in
 * `backend/discovery/sourcingRun.ts`, which is the half that reads datasets and
 * reaches the Fetcher. Types here, orchestration there.
 */

export type LeadSignal =
  | "prepared-but-unsold"
  | "probate-notice"
  | "owner-insolvent"
  | "negative-equity";

/** One motivated-seller lead for a named person to investigate. Never a recipient. */
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
   * to make contact, never lowers it.
   */
  readonly heightenedProtection: boolean;
  readonly provenance: SourceAttribution;
  /** The lawful next step a named person takes. Never "send". */
  readonly lawfulNextStep: string;
  /**
   * The contact for service named in the notice — the executor or solicitor to
   * write to. Read from the notice itself, where it is published; absent where
   * it was not fetched or the notice does not carry one.
   */
  readonly contactForService?: string;
  /** The notice's own public page, so the source opens from inside Lode. */
  readonly sourceUrl?: string;
  /**
   * A print-ready letter to the office-holder — the estate's personal
   * representatives on a probate lead, the trustee in bankruptcy / Official
   * Receiver on a bankruptcy-order lead. Drafted for a named person to print and
   * post, never sent automatically, and never addressed to the bereaved or the
   * bankrupt. Absent on signals that have no lawful letter recipient (an IVA or
   * DRO does not vest the home in anyone, so there is no office-holder to write
   * to).
   */
  readonly letterDraft?: string;
  /** The property address as stated, for starting a deal from the lead. */
  readonly propertyAddress?: string;
  /** The deceased or debtor named, recorded on the deal this lead becomes. */
  readonly subjectName?: string;
}

/**
 * The stable identity a lead is suppressed by once it has been written to.
 *
 * A prepared-but-unsold property is keyed by its address key (the same id the
 * worklist uses); a probate or insolvency notice by its public notice URL. These
 * are the only signals that carry a letter to print, so the only ones that can
 * be "contacted". Returns undefined for anything else, or where the lead carries
 * neither key — it then cannot be suppressed, which is the safe default (it may
 * reappear) rather than risk suppressing the wrong thing on a shared key.
 */
export function leadContactKey(
  lead: Pick<SourcedLead, "signalKey" | "addressKey" | "sourceUrl">,
): string | undefined {
  if (lead.signalKey === "prepared-but-unsold") return lead.addressKey;
  if (lead.signalKey === "probate-notice" || lead.signalKey === "owner-insolvent") {
    return lead.sourceUrl;
  }
  return undefined;
}

/**
 * A completed nearby refurbishment, as market evidence — not a lead.
 *
 * A flip someone else already did tells you the finished value the street will
 * actually pay, evidenced by a registered sale rather than an asking price. It
 * is shown separately from leads so a comparable is never mistaken for a
 * motivated seller. The uplift is gross, stated as gross.
 */
export interface FlipEvidence {
  readonly addressKey: string;
  readonly postcode: string;
  readonly boughtAt: string;
  readonly boughtFor: Money;
  readonly soldAt: string;
  readonly soldFor: Money;
  readonly monthsHeld: number;
  /** Basis points of gross uplift, before any costs. */
  readonly upliftBps: number;
}

export type ReadinessState = "ready" | "needs-dataset" | "needs-credential" | "needs-arrangement";

export interface SourceReadiness {
  readonly sourceKey: string;
  readonly name: string;
  readonly state: ReadinessState;
  readonly detail: string;
}

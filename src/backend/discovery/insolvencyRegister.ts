import { assertSourceUsable } from "@shared/domain/sources";
import type { Provenance } from "@shared/domain/outreach";

/**
 * The Individual Insolvency Register: authoritative per-person confirmation.
 *
 * The Gazette carries insolvency *notices* and is the practical discovery feed
 * (`gazette.ts`). This register is the Insolvency Service's authoritative record
 * of who is currently bankrupt, in an IVA or under a debt relief order — the
 * difference between "a notice was published" and "this person is on the
 * register today". It is to the insolvency signal what the HM Land Registry
 * title is to ownership: the confirmation step, consulted for one person being
 * genuinely pursued, not a list to harvest.
 *
 * There is a deliberate asymmetry with `gazette.ts`. The Gazette publishes a
 * clean, licensed JSON API, so its adapter fetches through the `Fetcher`. The
 * Insolvency Register does not expose a comparable open REST endpoint — public
 * access is a form-backed search, and bulk access is a data-access arrangement
 * with the Insolvency Service. So this adapter does not fetch. It parses a
 * record obtained through that arrangement and takes it as an argument, exactly
 * as `lookupOwner()` takes a title register rather than reaching for one. When
 * a licensed endpoint exists, a connector is added here and nowhere else.
 *
 * `internal-analysis` only, enforced by the source licence: this is distress
 * data about a named, living, vulnerable individual. It informs a decision to
 * approach by letter under heightened protection; it is never shown to a buyer
 * or published on a card.
 *
 * NOTE ON VERIFICATION: no live access has been made. The parser is
 * fixture-tested against the register's published field conventions. Confirm
 * the exact field names against a real record before relying on a production
 * run, and record the data-access arrangement as a licence first.
 */

export const INSOLVENCY_SOURCE = "insolvency-register";

export type InsolvencyStatus =
  | "bankruptcy"
  | "individual-voluntary-arrangement"
  | "debt-relief-order"
  | "restrictions-order"
  | "unknown";

/** One entry on the register, reduced to what is stated. Nothing inferred. */
export interface InsolvencyRegisterRecord {
  readonly caseNumber: string;
  readonly name: string;
  readonly status: InsolvencyStatus;
  /** As stated on the record, verbatim and un-split. */
  readonly address?: string;
  /** ISO-8601 where stated. */
  readonly dateOfBirth?: string;
  readonly startDate?: string;
  /**
   * True only where the register says the insolvency is live. A discharged
   * bankruptcy or a completed IVA is on the register as history and is NOT a
   * current-distress signal — treating it as one would act on a resolved
   * situation.
   */
  readonly current: boolean;
}

function text(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function classify(stated: string | undefined): InsolvencyStatus {
  if (stated === undefined) return "unknown";
  const s = stated.toLowerCase();
  if (s.includes("bankrupt")) return "bankruptcy";
  if (s.includes("voluntary arrangement") || /\biva\b/.test(s)) return "individual-voluntary-arrangement";
  if (s.includes("debt relief") || /\bdro\b/.test(s)) return "debt-relief-order";
  if (s.includes("restrictions")) return "restrictions-order";
  return "unknown";
}

/**
 * Parse one register record obtained through a data-access arrangement.
 *
 * Returns undefined on anything that is not a record with a case number and a
 * name — the two fields without which there is nothing to confirm against.
 */
export function parseInsolvencyRegisterRecord(json: unknown): InsolvencyRegisterRecord | undefined {
  // Reading the register is a licensed act; assert it at the point of parsing,
  // which is where the data is taken into the platform.
  assertSourceUsable(INSOLVENCY_SOURCE, "internal-analysis");

  if (typeof json !== "object" || json === null) return undefined;
  const record = json as Record<string, unknown>;

  const caseNumber = text(record, ["caseNumber", "case_number", "caseNo", "courtCaseNumber"]);
  const name = text(record, ["name", "individualName", "fullName", "debtorName"]);
  if (caseNumber === undefined || name === undefined) return undefined;

  const status = classify(text(record, ["insolvencyType", "status", "type", "caseType"]));
  const address = text(record, ["address", "lastKnownAddress", "residentialAddress"]);
  const dateOfBirth = text(record, ["dateOfBirth", "dob"]);
  const startDate = text(record, ["startDate", "orderDate", "insolvencyDate"]);

  // The register states currency explicitly; absence is read as not-current,
  // never as current. Caution on absence, never less.
  const statedCurrent = record["current"] ?? record["active"] ?? record["isCurrent"];
  const current =
    statedCurrent === true ||
    (typeof statedCurrent === "string" && ["true", "yes", "current", "live", "active"].includes(statedCurrent.toLowerCase()));

  return {
    caseNumber,
    name,
    status,
    ...(address !== undefined ? { address } : {}),
    ...(dateOfBirth !== undefined ? { dateOfBirth } : {}),
    ...(startDate !== undefined ? { startDate } : {}),
    current,
  };
}

export interface InsolvencyConfirmation {
  readonly confirmed: boolean;
  readonly status: InsolvencyStatus;
  readonly reason: string;
  readonly provenance: Provenance;
}

/**
 * Confirm whether a named person has a current insolvency on the register.
 *
 * The match is on name, with address as corroboration where both carry one —
 * never on name alone across a different address, because two people share a
 * name and acting on the wrong one is acting on a stranger's misfortune. Only a
 * record the register marks current confirms the signal; a discharged or
 * historical entry does not.
 */
export function confirmInsolvency(
  name: string,
  records: readonly InsolvencyRegisterRecord[],
  observedAt: string,
  corroboratingPostcode?: string,
): InsolvencyConfirmation {
  const provenance: Provenance = { sourceKey: INSOLVENCY_SOURCE, observedAt, inferred: false };
  const target = normalise(name);

  const matches = records.filter((record) => normalise(record.name) === target && record.current);
  if (matches.length === 0) {
    return {
      confirmed: false,
      status: "unknown",
      reason: "No current insolvency on the register for that name.",
      provenance,
    };
  }

  // Where a postcode is available on both sides, require it to agree; a name
  // match at a different address is a different person until proven otherwise.
  if (corroboratingPostcode !== undefined) {
    const pc = corroboratingPostcode.toUpperCase().replace(/\s+/g, "");
    const corroborated = matches.find(
      (m) => m.address !== undefined && m.address.toUpperCase().replace(/\s+/g, "").includes(pc),
    );
    if (corroborated === undefined) {
      return {
        confirmed: false,
        status: "unknown",
        reason:
          "A name matched but at a different address. Shared names make a name-only match unsafe, so this is not confirmed.",
        provenance,
      };
    }
    return {
      confirmed: true,
      status: corroborated.status,
      reason: `Current ${corroborated.status} on the register, address corroborated.`,
      provenance,
    };
  }

  const first = matches[0];
  return {
    confirmed: true,
    status: first?.status ?? "unknown",
    reason: `Current ${first?.status ?? "insolvency"} on the register for that name (address not corroborated).`,
    provenance,
  };
}

function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

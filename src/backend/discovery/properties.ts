import { assertSourceUsable } from "@shared/domain/sources";
import { fromMajor, money, type Money } from "@shared/money";

/**
 * Finding properties nobody has listed, from two licensed open datasets.
 *
 * The registry already knew which sources may be read and `registryFor()`
 * already enriches a property somebody named. What was missing was the other
 * direction: nothing took an area and returned candidates, so the platform
 * could appraise supply it was given and could not find any.
 *
 * The method is the one the blog sets out, and it is worth restating because
 * it is the whole reason this is possible without touching a portal. An energy
 * performance certificate is a legal precondition of marketing a residential
 * property, so a certificate exists because somebody intended to sell. Price
 * Paid Data records every registered sale. Join them on the address and the
 * interesting set is the one defined by an absence: a certificate lodged
 * months ago with no sale registered since.
 *
 * That property was prepared for sale and did not sell. No portal publishes
 * it, because it is defined by the listing having gone rather than by one
 * being there.
 *
 * Both sources are read through `Fetcher`, which checks the licence before it
 * checks anything else, and both are bound to their own hosts. Portal
 * listings, LinkedIn and pattern-guessed addresses are refused in the registry
 * with the reason written down, and this module cannot reach them: there is no
 * second outbound path and `assertSourceUsable()` is called at ingestion
 * rather than at display, because the exposure is created by taking the data.
 */

export const PPD_SOURCE = "land-registry-ppd";
export const EPC_SOURCE = "epc-register";

/* --------------------------------------------------------- Price Paid Data */

/**
 * One registered sale.
 *
 * The published file has no header row and sixteen columns in a fixed order.
 * Only the ones that carry signal are kept; the transaction identifier and the
 * administrative geography are dropped rather than stored unread.
 */
export interface PricePaidRecord {
  readonly price: Money;
  /** ISO-8601 date of transfer. */
  readonly soldAt: string;
  readonly postcode: string;
  /** D, S, T, F, O — detached, semi, terraced, flat, other. */
  readonly propertyType: string;
  readonly newBuild: boolean;
  /** F or L. */
  readonly tenure: string;
  /** Primary addressable object name: the house number or name. */
  readonly paon: string;
  /** Secondary: the flat or unit, where there is one. */
  readonly saon: string;
  readonly street: string;
  /**
   * A: a standard price-paid transaction at arm's length.
   * B: anything else — repossessions, buy-to-lets sold as portfolios,
   *    transfers between related parties, prices that are not market prices.
   */
  readonly category: "A" | "B";
}

/** A quoted CSV row split correctly, which a naive comma split does not do. */
function splitRow(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      // A doubled quote inside a quoted field is a literal quote.
      if (quoted && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * Parse the published file.
 *
 * Tolerant of a bad row and intolerant of a bad file. One malformed line in
 * two million is a data-quality fact about somebody else's export and must not
 * cost the whole run; a file whose every row fails is a format change and
 * should be noticed rather than silently yielding nothing.
 */
export function parsePricePaid(csv: string): {
  readonly records: readonly PricePaidRecord[];
  readonly skipped: number;
} {
  assertSourceUsable(PPD_SOURCE, "internal-analysis");

  const records: PricePaidRecord[] = [];
  let skipped = 0;

  for (const line of csv.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const f = splitRow(line).map((v) => v.replace(/^"|"$/g, "").trim());
    // 16 columns in the published order. Anything shorter is not a row.
    if (f.length < 15) {
      skipped += 1;
      continue;
    }

    const pence = Number(f[1]);
    const date = (f[2] ?? "").slice(0, 10);
    const category = f[14] === "B" ? "B" : f[14] === "A" ? "A" : undefined;

    if (!Number.isFinite(pence) || pence <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || category === undefined) {
      skipped += 1;
      continue;
    }

    records.push({
      // The file publishes whole pounds. Money is integer pence everywhere
      // here, so it converts once, at the edge, rather than being compared
      // against pence figures later by somebody who did not notice.
      price: fromMajor(pence),
      soldAt: date,
      postcode: (f[3] ?? "").toUpperCase().replace(/\s+/g, " "),
      propertyType: f[4] ?? "",
      newBuild: f[5] === "Y",
      tenure: f[6] ?? "",
      paon: f[7] ?? "",
      saon: f[8] ?? "",
      street: f[9] ?? "",
      category,
    });
  }

  return { records, skipped };
}

/* ----------------------------------------------------------- the EPC half */

/** One lodged certificate, reduced to what matters. */
export interface EpcRecord {
  readonly postcode: string;
  readonly paon: string;
  readonly saon: string;
  readonly street: string;
  /** ISO-8601. */
  readonly lodgedAt: string;
  readonly rating: string;
  readonly floorAreaSqm?: number;
  readonly constructionAgeBand?: string;
}

/**
 * Parse the EPC bulk file, which — unlike Price Paid — has a header row.
 *
 * The published export is a wide CSV and the columns are addressed by name
 * rather than by position, because the EPC schema adds columns over time and a
 * positional read would silently take the wrong field after a schema change.
 * The address arrives as one or two free-text lines rather than split into
 * house number and street the way Price Paid splits it, so the leading token of
 * the first line is taken as the addressable object name and the remainder as
 * the street — best-effort, and the direction to be wrong in is a missed match
 * (`addressKey` already documents that false negatives are acceptable and false
 * positives are not).
 *
 * Tolerant of a bad row, intolerant of a bad file, exactly as `parsePricePaid`.
 */
export function parseEpc(csv: string): { readonly records: readonly EpcRecord[]; readonly skipped: number } {
  assertSourceUsable(EPC_SOURCE, "internal-analysis");

  const lines = csv.split(/\r?\n/);
  const headerLine = lines.find((l) => l.trim() !== "");
  if (headerLine === undefined) return { records: [], skipped: 0 };

  const header = splitRow(headerLine).map((h) => h.replace(/^"|"$/g, "").trim().toUpperCase());
  const at = (name: string): number => header.indexOf(name);
  const iPostcode = at("POSTCODE");
  const iAddr1 = at("ADDRESS1");
  const iLodged = at("LODGEMENT_DATE");
  const iRating = at("CURRENT_ENERGY_RATING");
  // Without these three there is nothing to join on or act on.
  if (iPostcode < 0 || iAddr1 < 0 || iLodged < 0) {
    return { records: [], skipped: Math.max(0, lines.filter((l) => l.trim() !== "").length - 1) };
  }
  const iAddr2 = at("ADDRESS2");
  const iArea = at("TOTAL_FLOOR_AREA");
  const iAge = at("CONSTRUCTION_AGE_BAND");

  const records: EpcRecord[] = [];
  let skipped = 0;
  let first = true;

  for (const line of lines) {
    if (line.trim() === "") continue;
    if (first) {
      first = false; // the header itself
      continue;
    }
    const f = splitRow(line).map((v) => v.replace(/^"|"$/g, "").trim());
    const postcode = (f[iPostcode] ?? "").toUpperCase().replace(/\s+/g, " ").trim();
    const address1 = f[iAddr1] ?? "";
    const lodged = (f[iLodged] ?? "").slice(0, 10);
    if (postcode === "" || address1 === "" || !/^\d{4}-\d{2}-\d{2}$/.test(lodged)) {
      skipped += 1;
      continue;
    }

    // Leading number or unit as the addressable object name, the rest as street.
    const trimmed = address1.replace(/,/g, " ").replace(/\s+/g, " ").trim();
    const match = /^(\d+[a-z]?)\s+(.*)$/i.exec(trimmed);
    const paon = match?.[1] ?? trimmed.split(" ")[0] ?? trimmed;
    const street = match?.[2] ?? trimmed.slice(paon.length).trim();

    const area = iArea >= 0 ? Number(f[iArea]) : NaN;

    records.push({
      postcode,
      paon,
      saon: iAddr2 >= 0 ? (f[iAddr2] ?? "") : "",
      street,
      lodgedAt: lodged,
      rating: iRating >= 0 ? (f[iRating] ?? "").toUpperCase() : "",
      ...(Number.isFinite(area) && area > 0 ? { floorAreaSqm: area } : {}),
      ...(iAge >= 0 && (f[iAge] ?? "").trim() !== "" ? { constructionAgeBand: (f[iAge] ?? "").trim() } : {}),
    });
  }

  return { records, skipped };
}

/* ------------------------------------------------------------- the join */

/**
 * An address, normalised so two spellings of it match.
 *
 * Postcode plus the addressable object names plus the street, all uppercased
 * with punctuation and runs of whitespace removed. It is not a UPRN and does
 * not pretend to be: this will miss a property whose street is abbreviated in
 * one dataset and spelled out in the other, and that is a false negative,
 * which is the direction to be wrong in. A false positive would mean deciding
 * a property had sold when it had not.
 */
export function addressKey(parts: {
  readonly postcode: string;
  readonly paon: string;
  readonly saon?: string;
  readonly street: string;
}): string {
  const clean = (value: string): string =>
    value.toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  return [clean(parts.postcode), clean(parts.saon ?? ""), clean(parts.paon), clean(parts.street)]
    .filter((part) => part !== "")
    .join("|");
}

export type CandidateStrength = "strong" | "worth-a-look";

export interface PropertyCandidate {
  readonly addressKey: string;
  readonly postcode: string;
  readonly paon: string;
  readonly saon: string;
  readonly street: string;
  /** When the certificate was lodged — the day somebody prepared to sell. */
  readonly preparedAt: string;
  readonly monthsSincePrepared: number;
  readonly epcRating: string;
  readonly floorAreaSqm?: number;
  readonly constructionAgeBand?: string;
  /** The last registered arm's-length sale, where there is one on record. */
  readonly lastSoldAt?: string;
  readonly lastSoldPrice?: Money;
  readonly strength: CandidateStrength;
  /** Why this address is here, in a sentence. Never a bare score. */
  readonly reason: string;
}

export interface CandidateSearch {
  readonly candidates: readonly PropertyCandidate[];
  /** Certificates considered. */
  readonly considered: number;
  /** Addresses dropped because a sale was registered after the certificate. */
  readonly soldSince: number;
  /** Certificates too recent to mean anything yet. */
  readonly tooRecent: number;
}

/** Below this a certificate just means a sale is in progress. */
export const MINIMUM_MONTHS = 6;
/** Beyond this the preparation is old enough to be a strong signal. */
export const STRONG_MONTHS = 12;

function monthsBetween(from: string, to: Date): number {
  const start = Date.parse(from);
  if (Number.isNaN(start)) return -1;
  return Math.floor((to.getTime() - start) / (1000 * 60 * 60 * 24 * 30.44));
}

/**
 * Certificates with no sale registered since.
 *
 * The window matters in both directions. Under six months a certificate
 * usually means a sale is simply still in progress — registration lags
 * completion by months, so a recent silence is not evidence of no sale. Past a
 * year, somebody prepared to sell a property and it is still theirs, which is
 * the signal worth acting on.
 *
 * Non-arm's-length sales are *counted* as sales. A repossession or a transfer
 * between related parties still means the property changed hands, and treating
 * it as no-sale would put a property somebody no longer owns on the list.
 * Category B is excluded from valuation comparables, which is a different
 * question, answered elsewhere.
 */
export function findCandidates(
  epc: readonly EpcRecord[],
  sales: readonly PricePaidRecord[],
  now: Date = new Date(),
): CandidateSearch {
  assertSourceUsable(EPC_SOURCE, "internal-analysis");
  assertSourceUsable(PPD_SOURCE, "internal-analysis");

  // Latest sale per address, whatever its category.
  const lastSale = new Map<string, PricePaidRecord>();
  for (const sale of sales) {
    const key = addressKey(sale);
    const held = lastSale.get(key);
    if (held === undefined || sale.soldAt > held.soldAt) lastSale.set(key, sale);
  }

  const candidates: PropertyCandidate[] = [];
  let soldSince = 0;
  let tooRecent = 0;

  for (const certificate of epc) {
    const key = addressKey(certificate);
    const months = monthsBetween(certificate.lodgedAt, now);

    if (months < MINIMUM_MONTHS) {
      tooRecent += 1;
      continue;
    }

    const sale = lastSale.get(key);
    // A sale registered on or after the certificate means it sold.
    if (sale !== undefined && sale.soldAt >= certificate.lodgedAt) {
      soldSince += 1;
      continue;
    }

    const strength: CandidateStrength = months >= STRONG_MONTHS ? "strong" : "worth-a-look";
    candidates.push({
      addressKey: key,
      postcode: certificate.postcode,
      paon: certificate.paon,
      saon: certificate.saon,
      street: certificate.street,
      preparedAt: certificate.lodgedAt,
      monthsSincePrepared: months,
      epcRating: certificate.rating,
      ...(certificate.floorAreaSqm === undefined ? {} : { floorAreaSqm: certificate.floorAreaSqm }),
      ...(certificate.constructionAgeBand === undefined
        ? {}
        : { constructionAgeBand: certificate.constructionAgeBand }),
      ...(sale === undefined ? {} : { lastSoldAt: sale.soldAt, lastSoldPrice: sale.price }),
      strength,
      reason:
        strength === "strong"
          ? `A certificate was lodged ${months} months ago and no sale has been registered since. Somebody took the legally required step to market this and it is still theirs.`
          : `A certificate was lodged ${months} months ago with no sale registered since. Registration lags completion, so this is worth checking rather than acting on.`,
    });
  }

  // Longest-prepared first: that is the order worth working.
  candidates.sort((a, b) => b.monthsSincePrepared - a.monthsSincePrepared);

  return { candidates, considered: epc.length, soldSince, tooRecent };
}

/* ------------------------------------------------- bought and flipped */

/** How close two sales must be to read as a flip rather than a move. */
export const FLIP_WINDOW_MONTHS = 18;
/** The uplift that marks a refurbishment rather than ordinary appreciation. */
export const FLIP_MIN_UPLIFT_BPS = 2_000; // 20%

export interface Flip {
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

/**
 * Pairs of arm's-length sales close together with a real jump between them.
 *
 * A flip that someone else already did is worth finding for the opposite
 * reason to a motivated seller: it tells you the finished value the street
 * will actually pay, evidenced by a completed sale rather than an asking
 * price. Both sales must be category A — a repossession bought cheap and sold
 * on is not the same signal and would overstate the achievable uplift.
 *
 * Gross uplift, stated as gross. The costs and the tax that turn it into a
 * margin are `appraise()`'s job, not this function's, and labelling a 30%
 * gross uplift as "profit" is exactly the mistake the rest of the platform
 * refuses to make.
 */
export function findFlips(
  sales: readonly PricePaidRecord[],
  windowMonths: number = FLIP_WINDOW_MONTHS,
  minUpliftBps: number = FLIP_MIN_UPLIFT_BPS,
): readonly Flip[] {
  assertSourceUsable(PPD_SOURCE, "internal-analysis");

  const byAddress = new Map<string, PricePaidRecord[]>();
  for (const sale of sales) {
    if (sale.category !== "A") continue;
    const key = addressKey(sale);
    const held = byAddress.get(key) ?? [];
    held.push(sale);
    byAddress.set(key, held);
  }

  const flips: Flip[] = [];
  for (const [key, group] of byAddress) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => a.soldAt.localeCompare(b.soldAt));
    for (let i = 1; i < ordered.length; i += 1) {
      const bought = ordered[i - 1];
      const sold = ordered[i];
      if (bought === undefined || sold === undefined) continue;

      const months = Math.round(
        (Date.parse(sold.soldAt) - Date.parse(bought.soldAt)) / (1000 * 60 * 60 * 24 * 30.44),
      );
      if (months <= 0 || months > windowMonths) continue;
      if (sold.price <= bought.price) continue;

      const upliftBps = Math.round(((sold.price - bought.price) / bought.price) * 10_000);
      if (upliftBps < minUpliftBps) continue;

      flips.push({
        addressKey: key,
        postcode: sold.postcode,
        boughtAt: bought.soldAt,
        boughtFor: bought.price,
        soldAt: sold.soldAt,
        soldFor: sold.price,
        monthsHeld: months,
        upliftBps,
      });
    }
  }

  return flips.sort((a, b) => b.upliftBps - a.upliftBps);
}

/* ------------------------------------------------------- negative equity */

export interface NegativeEquityFlag {
  readonly addressKey: string;
  readonly lastPaid: Money;
  readonly estimatedValue: Money;
  /** How far underwater, as basis points of the last paid price. */
  readonly shortfallBps: number;
}

/**
 * Whether the last paid price sits above a current estimate of value.
 *
 * The signal behind a lease option or an assisted sale: where an owner may owe
 * more than the property is worth, a route that needs no cash to change hands
 * at completion is sometimes the only one that works. Returns undefined rather
 * than a cheerful zero where either figure is missing — an absent estimate is
 * not evidence of equity.
 */
export function negativeEquity(
  lastPaid: Money | undefined,
  estimatedValue: Money | undefined,
): NegativeEquityFlag | undefined {
  if (lastPaid === undefined || estimatedValue === undefined) return undefined;
  if (lastPaid <= 0 || estimatedValue <= 0) return undefined;
  if (estimatedValue >= lastPaid) return undefined;
  return {
    addressKey: "",
    lastPaid,
    estimatedValue,
    shortfallBps: Math.round(((lastPaid - estimatedValue) / lastPaid) * 10_000),
  };
}

/**
 * A price per square metre for an area, from arm's-length sales only.
 *
 * Here because it is the other half of what Price Paid is for and it is one
 * line from the same records. Category B is excluded: leaving repossessions
 * and portfolio transfers in a local median drags it down and makes every deal
 * in the street look better than it is.
 */
export function medianPricePerSqm(
  sales: readonly PricePaidRecord[],
  floorAreaByAddress: ReadonlyMap<string, number>,
): Money | undefined {
  const rates: number[] = [];
  for (const sale of sales) {
    if (sale.category !== "A") continue;
    const area = floorAreaByAddress.get(addressKey(sale));
    if (area === undefined || area <= 0) continue;
    rates.push(sale.price / area);
  }
  if (rates.length === 0) return undefined;
  rates.sort((a, b) => a - b);
  const middle = Math.floor(rates.length / 2);
  const median =
    rates.length % 2 === 0 ? ((rates[middle - 1] ?? 0) + (rates[middle] ?? 0)) / 2 : (rates[middle] ?? 0);
  return money(Math.round(median));
}

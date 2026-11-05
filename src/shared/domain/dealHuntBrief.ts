import { fromMajor } from "@shared/money";
import {
  validateCriteria,
  type CriteriaDraft,
  type CriteriaValidation,
} from "@shared/domain/dealHunt";

/**
 * Deal Hunt brief interpretation (Deal Hunt spec §2/§5, DH01/DH02/DH14).
 *
 * An investor types a brief in plain English; this turns it into editable,
 * typed filters and shows what it understood before anything is submitted. It is
 * DETERMINISTIC on purpose (decision #50): a model may later propose the same
 * draft, but the draft is only ever accepted through `validateCriteria`, so a
 * brief that smuggles in "ignore your rules and invent rents" changes nothing —
 * the parser only ever sets known, typed filter fields, and everything else is
 * ignored (DH14). A geography it cannot resolve, or a missing budget, surfaces
 * as a clarification and blocks a live hunt until resolved (DH02).
 *
 * Framework-free: geography resolution is injected, so the backend supplies the
 * authorised resolver and this stays pure and testable.
 */

export interface GeographyResolution {
  readonly id?: string;
  /** Candidate labels when a place name is ambiguous and needs selection. */
  readonly ambiguous?: readonly string[];
  readonly input: string;
}

export interface InterpretClarification {
  readonly field: string;
  readonly message: string;
  readonly options?: readonly string[];
}

export interface InterpretResult {
  readonly draft: CriteriaDraft;
  readonly validation: CriteriaValidation;
  readonly clarifications: readonly InterpretClarification[];
  /** A plain statement of what was understood, shown before submission (DH01). */
  readonly interpretation: string;
}

const KNOWN_TYPES: Record<string, string> = {
  house: "house",
  houses: "house",
  flat: "flat",
  flats: "flat",
  bungalow: "bungalow",
  bungalows: "bungalow",
  maisonette: "maisonette",
  maisonettes: "maisonette",
};

function parsePricePence(brief: string): number | undefined {
  // "under £225,000", "below 225k", "£225k"
  const m = /(?:under|below|up to|max(?:imum)?|£|<)\s*£?\s*([\d][\d,]*)\s*(k|,000)?/i.exec(brief);
  if (m === null) {
    const bare = /£\s*([\d][\d,]*)\s*(k)?/i.exec(brief);
    if (bare === null) return undefined;
    return normaliseAmount(bare[1]!, bare[2]);
  }
  return normaliseAmount(m[1]!, m[2]);
}

function normaliseAmount(digits: string, suffix: string | undefined): number {
  const n = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(n)) return Number.NaN;
  const major = suffix?.toLowerCase() === "k" ? n * 1000 : n;
  return Number(fromMajor(Math.round(major)));
}

function parseBedrooms(brief: string): { min?: number; max?: number } {
  // "2-3 bed", "2 to 3 bedroom", "3 bed"
  const range = /(\d+)\s*(?:-|–|to)\s*(\d+)\s*bed/i.exec(brief);
  if (range !== null) return { min: Number(range[1]), max: Number(range[2]) };
  const single = /(\d+)\s*bed/i.exec(brief);
  if (single !== null) return { min: Number(single[1]), max: Number(single[1]) };
  return {};
}

function parseDays(brief: string): number | undefined {
  const m = /(?:last|within|past)\s*(\d+)\s*days/i.exec(brief) ?? /(\d+)\s*days/i.exec(brief);
  return m !== null ? Number(m[1]) : undefined;
}

function parseDropBps(brief: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(brief);
  if (m === null) return undefined;
  return Math.round(Number(m[1]) * 100); // 5% → 500 bps
}

function parseTypes(brief: string): string[] {
  const found = new Set<string>();
  for (const [word, canon] of Object.entries(KNOWN_TYPES)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(brief)) found.add(canon);
  }
  return [...found];
}

/**
 * Interpret a brief into a draft, a validation and the clarifications a live
 * hunt still needs. `resolveGeography` is the authorised resolver.
 */
export function interpretBrief(
  brief: string,
  resolveGeography: (brief: string) => GeographyResolution,
): InterpretResult {
  const geo = resolveGeography(brief);
  const pricePence = parsePricePence(brief);
  const beds = parseBedrooms(brief);
  const days = parseDays(brief);
  const dropBps = parseDropBps(brief);
  const types = parseTypes(brief);
  const mentionsFellThrough = /fell through|fall[-\s]?through|collapsed sale|sale fell/i.test(brief);

  const draft: CriteriaDraft = {
    ...(geo.id !== undefined ? { geographyId: geo.id } : {}),
    ...(types.length > 0 ? { propertyTypes: types } : {}),
    ...(beds.min !== undefined ? { bedroomsMin: beds.min } : {}),
    ...(beds.max !== undefined ? { bedroomsMax: beds.max } : {}),
    ...(pricePence !== undefined ? { askingPriceLimitPence: pricePence } : {}),
    ...(days !== undefined ? { returnedWithinDays: days } : {}),
    ...(dropBps !== undefined ? { minimumDropBps: dropBps } : {}),
  };

  const validation = validateCriteria(draft);

  const clarifications: InterpretClarification[] = [];
  if (geo.id === undefined) {
    clarifications.push({
      field: "geography",
      message:
        geo.ambiguous !== undefined && geo.ambiguous.length > 0
          ? `"${geo.input}" is ambiguous — choose the area.`
          : `Could not resolve a geography from "${geo.input}". Choose an area.`,
      ...(geo.ambiguous !== undefined ? { options: geo.ambiguous } : {}),
    });
  }
  if (pricePence === undefined) {
    clarifications.push({ field: "askingPriceLimitPence", message: "No price ceiling found — set one to run a hunt." });
  }
  if (mentionsFellThrough) {
    // DH06: a confirmed failure and a listing returning to market are different
    // claims — preview the distinction and let the investor choose.
    clarifications.push({
      field: "eventRequirement",
      message:
        'You mentioned a sale falling through. "Returned to market" includes listings back on sale for any reason; "confirmed fall-through" needs source evidence of a failed sale. Which do you want?',
      options: ["returned_to_market", "confirmed_fall_through"],
    });
  }

  const parts: string[] = [];
  if (types.length > 0) parts.push(types.join("/"));
  if (beds.min !== undefined) parts.push(beds.max !== undefined && beds.max !== beds.min ? `${beds.min}–${beds.max} bed` : `${beds.min} bed`);
  if (geo.id !== undefined) parts.push(`in ${geo.id}`);
  if (pricePence !== undefined) parts.push(`under the price ceiling`);
  if (days !== undefined) parts.push(`returned within ${days} days`);
  if (dropBps !== undefined) parts.push(`down at least ${(dropBps / 100).toFixed(dropBps % 100 === 0 ? 0 : 1)}%`);
  const interpretation = parts.length > 0 ? `Understood: ${parts.join(", ")}.` : "Nothing specific could be read from the brief — enter the filters manually.";

  return { draft, validation, clarifications, interpretation };
}

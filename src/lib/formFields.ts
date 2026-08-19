import { bps, fromMajor, type Bps, type Money } from "@/lib/money";

/**
 * Strict form-field parsing.
 *
 * Shared by every server action that accepts a form, because the alternative is
 * each one growing its own slightly different money parser — the same drift
 * that produced five private `fmt()` functions before `lib/format.ts` existed.
 *
 * Parsing is strict and total: anything not recognised is rejected rather than
 * coerced to a default. A silently defaulted jurisdiction changes which
 * structures are lawful; a silently defaulted price limit changes which deals a
 * funder is shown. A bad field must fail loudly rather than quietly produce a
 * plausible answer.
 */

/** What a mandate form hands back to the client component that rendered it. */
export interface BoxFormResult {
  readonly ok: boolean;
  readonly message: string;
}

export function requireOneOf<T extends string>(
  raw: FormDataEntryValue | null,
  allowed: ReadonlySet<string>,
  field: string,
): T {
  const value = typeof raw === "string" ? raw : "";
  if (!allowed.has(value)) {
    throw new Error(`Invalid value for ${field}`);
  }
  return value as T;
}

/** Every submitted value that is in the allowed set, deduplicated. */
export function manyOf<T extends string>(
  raws: readonly FormDataEntryValue[],
  allowed: ReadonlySet<string>,
): readonly T[] {
  const seen = new Set<string>();
  for (const raw of raws) {
    if (typeof raw === "string" && allowed.has(raw)) seen.add(raw);
  }
  return [...seen] as T[];
}

/** At least one value from the allowed set, or the action fails. */
export function requireManyOf<T extends string>(
  raws: readonly FormDataEntryValue[],
  allowed: ReadonlySet<string>,
  field: string,
): readonly T[] {
  const values = manyOf<T>(raws, allowed);
  if (values.length === 0) throw new Error(`Choose at least one ${field}`);
  return values;
}

export function optionalMoney(raw: FormDataEntryValue | null): Money | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const parsed = Number(raw.replace(/[£,\s]/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return fromMajor(Math.round(parsed));
}

export function requiredMoney(raw: FormDataEntryValue | null, field: string): Money {
  const value = optionalMoney(raw);
  if (value === undefined) throw new Error(`${field} must be a positive amount`);
  return value;
}

export function optionalNumber(raw: FormDataEntryValue | null): number | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

/**
 * A whole number within an inclusive range.
 *
 * Zero is a meaningful answer for several mandate fields — a minimum bedroom
 * count, a required track record — so this cannot reuse `optionalNumber`,
 * which treats zero as absent.
 */
export function requiredInteger(
  raw: FormDataEntryValue | null,
  field: string,
  { min, max }: { min: number; max: number },
): number {
  const parsed = typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a number`);
  const rounded = Math.round(parsed);
  if (rounded < min || rounded > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
  return rounded;
}

/**
 * A percentage typed as a percentage, stored as basis points.
 *
 * Forms ask for "15" because that is what a funder says; the engine works in
 * basis points throughout. Converting at the boundary keeps every rate in one
 * unit behind the branded type.
 */
export function requiredPercent(raw: FormDataEntryValue | null, field: string): Bps {
  const parsed = typeof raw === "string" ? Number(raw.replace(/[%\s]/g, "")) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`${field} must be a percentage between 0 and 100`);
  }
  return bps(Math.round(parsed * 100));
}

/** An unticked checkbox submits nothing at all, which is the `false` case. */
export function checkbox(raw: FormDataEntryValue | null): boolean {
  return raw === "on" || raw === "true" || raw === "yes";
}

/** Trimmed, length-capped free text. Empty is rejected. */
export function requiredText(
  raw: FormDataEntryValue | null,
  field: string,
  maxLength = 120,
): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "") throw new Error(`${field} is required`);
  return value.slice(0, maxLength);
}

/**
 * A comma-separated list, such as the localities a mandate covers.
 *
 * Capped in both directions: an empty list means "anywhere", which several
 * matchers treat as unrestricted, and an unbounded one is a way to push
 * arbitrary volumes of text into the store.
 */
export function textList(
  raw: FormDataEntryValue | null,
  { maxItems = 40, maxLength = 60 }: { maxItems?: number; maxLength?: number } = {},
): readonly string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((part) => part.trim().slice(0, maxLength))
    .filter((part) => part !== "")
    .slice(0, maxItems);
}

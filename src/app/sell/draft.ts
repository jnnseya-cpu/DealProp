/**
 * Draft-save for the seller intake, kept deliberately narrow.
 *
 * The problem this solves is real: the intake is five steps, and a seller on a
 * patchy mobile connection who refreshes, presses Back, or trips the rate limit
 * loses everything they typed and usually does not start again. So we keep a
 * draft — but this form also asks about health, financial distress and
 * capacity, and takes a free-text note that can contain anything. Writing that
 * to a device would undo the care the rest of the platform takes with it: a
 * vulnerable seller may be on a shared or public machine, which is exactly who
 * Seller Protection exists for.
 *
 * Two decisions follow from that:
 *
 *  1. **An allowlist, not a denylist.** Only the fields named in `DRAFT_FIELDS`
 *     are ever written. A field added to the form in future is NOT persisted
 *     until someone adds it here on purpose — the safe default is "not kept".
 *     The special-category answers and the narrative are absent by design, and
 *     `tests/sellDraft.test.ts` fails if any of them ever appears here.
 *
 *  2. **sessionStorage, not localStorage.** The draft survives a refresh, the
 *     Back button and the server's own needs-consent / slow-down redirect —
 *     all within the one browser session — and is gone when the tab closes. It
 *     never persists across sessions, never reaches another tab, another device
 *     or our servers, and is cleared outright once the enquiry is sent.
 *
 * This is the first use of browser storage in the codebase, which is itself a
 * reason to keep it this small.
 */

export const DRAFT_KEY = "lode:sell-draft";

/**
 * The only fields that may be written to the device. Situation, priorities,
 * the property facts and the valuation figures — enough to spare the seller the
 * tedious retyping, and none of it special-category data.
 */
export const DRAFT_FIELDS = [
  "situation",
  "priorities",
  "tenure",
  "targetDays",
  "postcodeArea",
  "locality",
  "jurisdiction",
  "propertyType",
  "bedrooms",
  "leaseYearsRemaining",
  "condition",
  "issues",
  "sellerValuation",
  "currentAsking",
  "priceExpectation",
] as const;

/**
 * Named explicitly so the test can assert the two sets never overlap. These are
 * the fields that must never be written to a device: the screening answers that
 * feed Seller Protection, the free-text note, age, and the consent boxes (which
 * are re-affirmed on every submission on purpose).
 */
export const DRAFT_EXCLUDED = [
  "narrative",
  "isSoleDecisionMaker",
  "hasIndependentLegalAdvice",
  "hasReceivedIndependentValuation",
  "reportsFinancialDistress",
  "isUnderTimePressureFromThirdParty",
  "reportsHealthOrCapacityConcern",
  "ageBand",
  "ownerAffirmed",
  "privacyAcknowledged",
] as const;

const ALLOWED = new Set<string>(DRAFT_FIELDS);

/**
 * Fields that are checkbox groups and so are always an array, even with one
 * value selected — otherwise a single choice would round-trip as a string and
 * the form would restore it into the wrong shape.
 */
const MULTI = new Set<string>(["priorities", "issues"]);

export interface SellDraft {
  readonly v: 1;
  readonly step: number;
  readonly values: Record<string, string | string[]>;
}

/**
 * The privacy guarantee lives here: reduce raw form entries to the allowlist
 * only. Pure and exported so it can be tested in isolation — this is the
 * function that must never let a sensitive field through, whichever direction
 * (saving, or reloading a stored draft) it is used in.
 */
export function pickDraftValues(
  entries: Iterable<readonly [string, string]>,
): Record<string, string | string[]> {
  const multi = new Map<string, string[]>();
  for (const [name, value] of entries) {
    if (!ALLOWED.has(name) || value === "") continue;
    const existing = multi.get(name);
    if (existing === undefined) multi.set(name, [value]);
    else existing.push(value);
  }
  const out: Record<string, string | string[]> = {};
  for (const [name, list] of multi) {
    if (MULTI.has(name)) {
      out[name] = list;
      continue;
    }
    const single = list.length === 1 ? list[0] : undefined;
    out[name] = single === undefined ? list : single;
  }
  return out;
}

function store(explicit?: Storage): Storage | undefined {
  if (explicit !== undefined) return explicit;
  try {
    return typeof window !== "undefined" ? window.sessionStorage : undefined;
  } catch {
    return undefined;
  }
}

/** Save a draft. Never throws — a blocked or full store is not worth an error. */
export function saveDraft(draft: SellDraft, storage?: Storage): void {
  const s = store(storage);
  if (s === undefined) return;
  try {
    s.setItem(DRAFT_KEY, JSON.stringify({ v: 1, step: draft.step, values: pickDraftValues(Object.entries(draft.values).flatMap(flatten)) }));
  } catch {
    // ignore
  }
}

/**
 * Load a draft, or undefined. Re-filters the stored values through the
 * allowlist, so a draft tampered with in storage still cannot reintroduce a
 * field we refuse to keep. Never throws.
 */
export function loadDraft(storage?: Storage): SellDraft | undefined {
  const s = store(storage);
  if (s === undefined) return undefined;
  let raw: string | null;
  try {
    raw = s.getItem(DRAFT_KEY);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const obj = parsed as { v?: unknown; step?: unknown; values?: unknown };
    if (obj.v !== 1) return undefined;
    const step = typeof obj.step === "number" && Number.isFinite(obj.step) ? obj.step : 0;
    const rawValues = typeof obj.values === "object" && obj.values !== null ? (obj.values as Record<string, unknown>) : {};
    const values = pickDraftValues(Object.entries(rawValues).flatMap(flatten));
    return { v: 1, step, values };
  } catch {
    return undefined;
  }
}

/** Remove the draft. Never throws. Called once the enquiry is sent. */
export function clearDraft(storage?: Storage): void {
  const s = store(storage);
  if (s === undefined) return;
  try {
    s.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

/** Turn a [name, string | string[]] pair into one-or-many [name, string] pairs. */
function flatten([name, value]: [string, unknown]): Array<readonly [string, string]> {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string").map((v) => [name, v] as const);
  if (typeof value === "string") return [[name, value] as const];
  return [];
}

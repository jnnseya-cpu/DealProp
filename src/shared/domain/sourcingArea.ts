/**
 * Priority areas for sourcing — where Lode wants leads surfaced first.
 *
 * Pure and framework-free. A run is national (the Gazette feed is not
 * geographic), so without this the operator's target region is scattered
 * through the list and the priority leads are the ones that scroll off. This
 * floats them to the top; it changes the *order*, never the set, and never
 * warehouses anything.
 *
 * The default is the West and East Midlands by postcode area. It is overridable
 * at runtime (GAZETTE_PRIORITY_AREAS, comma-separated areas) so the priority can
 * move without a code change.
 */

/**
 * West & East Midlands postcode areas (the letters before the first digit).
 *
 * West Midlands: Birmingham, Coventry, Dudley, Hereford, Stoke, Telford,
 * Worcester, Walsall, Wolverhampton. East Midlands: Derby, Leicester, Lincoln,
 * Nottingham, Northampton. Borderline areas (Doncaster, Peterborough) are left
 * out on purpose; add them via the env override if wanted.
 */
export const DEFAULT_PRIORITY_AREAS: readonly string[] = [
  "B", "CV", "DY", "HR", "ST", "TF", "WR", "WS", "WV", // West Midlands
  "DE", "LE", "LN", "NG", "NN", // East Midlands
];

/** The postcode area — the one or two letters before the first digit. "B29 6AD" → "B". */
export function postcodeArea(postcode: string): string {
  const m = /^[A-Z]{1,2}/i.exec(postcode.trim());
  return m === null ? "" : m[0].toUpperCase();
}

/** Whether a postcode falls in one of the priority areas. */
export function isPriorityArea(postcode: string, areas: readonly string[] = DEFAULT_PRIORITY_AREAS): boolean {
  const area = postcodeArea(postcode);
  return area !== "" && areas.some((a) => a.toUpperCase() === area);
}

/**
 * Parse a comma-separated priority-area override, or undefined if none given.
 *
 * So a deployment can set GAZETTE_PRIORITY_AREAS="B,CV,NG" and the runs follow
 * it; unset falls back to {@link DEFAULT_PRIORITY_AREAS}.
 */
export function parsePriorityAreas(raw: string | undefined): readonly string[] | undefined {
  if (raw === undefined) return undefined;
  const areas = raw
    .split(",")
    .map((a) => a.trim().toUpperCase())
    .filter((a) => a !== "");
  return areas.length > 0 ? areas : undefined;
}

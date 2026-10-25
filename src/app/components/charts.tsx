/**
 * Chart primitives.
 *
 * The render layer only: every figure arrives as a prop, already computed by an
 * engine (CLAUDE.md — the frontend never computes a number). These are the
 * shared marks the dashboards are built from, so a bar on the operator cockpit
 * and a bar in the Deal Room are the same bar.
 *
 * Deliberately plain CSS, no SVG and no client runtime: a bar is a div whose
 * width is a percentage, so these render on the server inside a server
 * component with nothing shipped to the browser. The design decisions follow
 * the house rules and the data-viz method:
 *
 *  - Thin marks on an opaque track, a 4px rounded data-end, direct value
 *    labels — never a figure floating with no bar under it.
 *  - One hue for magnitude (the gold accent). The status palette
 *    (emerald/amber/orange/red) is reserved for a value whose *band is the
 *    finding*, and it matches `scoreTone` exactly so a number and its bar never
 *    disagree.
 *  - Figures are tabular (`tnum`) and wear an ink token, never the mark colour.
 *  - A pill is allowed for a progress bar and nothing else.
 */

/** One row of a {@link BarList}. */
export interface BarDatum {
  readonly label: string;
  /** The magnitude. Bars are scaled against the largest value in the list. */
  readonly value: number;
  /** What to print at the end of the bar. Defaults to the value itself. */
  readonly display?: string;
  /** A Tailwind background class for the fill, for a status band. Default gold. */
  readonly fill?: string;
  /** A sub-label under the row, for a qualifier. */
  readonly note?: string;
}

/**
 * Horizontal bars for comparing magnitudes — counts by stage, by area, by role.
 *
 * Scaled against the largest value so the longest bar fills the track and the
 * rest read in proportion. An empty list renders its own empty state rather
 * than a bare box, because "nothing yet" is a real state a dashboard must show.
 */
export function BarList({
  data,
  empty = "Nothing recorded yet.",
}: {
  data: readonly BarDatum[];
  empty?: string;
}) {
  const max = data.reduce((m, d) => Math.max(m, d.value), 0);
  if (data.length === 0) {
    return <p className="text-[13px] text-ink-500">{empty}</p>;
  }
  return (
    <ul className="space-y-2.5">
      {data.map((d) => {
        // A zero-value row still shows a sliver, so the label is never a bar
        // nobody can see; a positive value fills in proportion to the largest.
        const pct = max === 0 ? 0 : Math.round((d.value / max) * 100);
        return (
          <li key={d.label}>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-[13px] text-ink-300">{d.label}</span>
              <span className="tnum shrink-0 text-[13px] text-ink-100">{d.display ?? String(d.value)}</span>
            </div>
            <div
              className="mt-1.5 h-2 w-full overflow-hidden rounded-[3px] bg-surface-3"
              role="img"
              aria-label={`${d.label}: ${d.display ?? String(d.value)}`}
            >
              <div
                className={`h-full rounded-[3px] ${d.fill ?? "bg-lode-400"}`}
                style={{ width: `${Math.max(pct, d.value > 0 ? 3 : 0)}%` }}
              />
            </div>
            {d.note !== undefined && <p className="mt-1 text-[11px] text-ink-500">{d.note}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/** One segment of a {@link StackedBar}. */
export interface StackSegment {
  readonly label: string;
  readonly value: number;
  readonly display: string;
  /** A Tailwind background class. Shades of one hue read as parts of a whole. */
  readonly fill: string;
}

/**
 * A single horizontal bar divided into parts of a whole — the capital stack,
 * where senior / mezzanine / equity are shades of the one accent rather than
 * four competing hues, each named directly in the legend so identity never
 * rests on colour alone. A 2px surface gap sits between segments so two fills
 * never touch.
 */
export function StackedBar({ segments }: { segments: readonly StackSegment[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <p className="text-[13px] text-ink-500">Nothing to stack yet.</p>;
  return (
    <div>
      <div className="flex h-7 w-full gap-0.5 overflow-hidden rounded-[4px]">
        {segments.map((s) => (
          <div
            key={s.label}
            className={s.fill}
            style={{ width: `${(s.value / total) * 100}%` }}
            role="img"
            aria-label={`${s.label}: ${s.display}`}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-[12px] text-ink-300">
            <span className={`h-2.5 w-2.5 rounded-[2px] ${s.fill}`} aria-hidden />
            {s.label}
            <span className="tnum text-ink-100">{s.display}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A 0–100 meter whose band is the finding — a readiness or a score. The fill
 * colour comes from the same thresholds as the number beside it, passed in by
 * the caller via `fill` so this mark never invents its own idea of "good". A
 * progress bar is the one place a pill shape is allowed.
 */
export function Meter({
  value,
  max = 100,
  fill = "bg-lode-400",
}: {
  value: number;
  max?: number;
  fill?: string;
}) {
  const pct = max === 0 ? 0 : Math.min(100, Math.max(0, Math.round((value / max) * 100)));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
      role="img"
      aria-label={`${value} of ${max}`}
    >
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

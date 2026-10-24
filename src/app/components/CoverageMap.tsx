import { isDealReady } from "@shared/domain/jurisdictions";
import type { JurisdictionCode } from "@shared/domain/types";

/**
 * Where Lode operates, as a self-contained map.
 *
 * This is deliberately NOT a slippy map with external tiles, and deliberately
 * NOT a property-pin heat view. Two reasons, both load-bearing:
 *
 *  1. Per-property location only exists on the gated, privacy-hardened pages
 *     (`/opportunities` requires `view-deal-material`). A map there that fetched
 *     tiles or geocoded an address would reach an external host from a page
 *     carrying seller data — exactly what the CSP (`img-src 'self' data: blob:`)
 *     exists to stop. So a public map shows jurisdiction coverage, never a
 *     seller's position.
 *  2. There is no new dependency, no external request and no CSP change. The
 *     outline is inline SVG and the status is read from the one source of truth
 *     — `isDealReady()` — so the map cannot claim a nation is live when the
 *     rate tables for it are not verified.
 *
 * Colours are the globals.css tokens referenced as CSS variables, never new
 * literals, so the map never drifts from the design system.
 */

interface Region {
  readonly code: JurisdictionCode;
  readonly name: string;
  /** Simplified silhouette — recognisable, not survey-accurate. */
  readonly path: string;
  /** Centroid for the live dot, in viewBox units. */
  readonly dot: readonly [number, number];
}

// Simplified low-poly British Isles on a 360×480 viewBox. The four nations are
// separate closed paths so each can carry its own live/capped status; the shape
// is a deliberate stylisation, not a survey outline. England's western edge
// (x≈206) is shared with Wales so the two tile without a gap.
const REGIONS: readonly Region[] = [
  {
    code: "GB-SCT",
    name: "Scotland",
    dot: [212, 118],
    path: "M178,66 L214,44 L250,58 L276,86 L262,120 L246,150 L232,178 L206,196 L186,178 L166,150 L152,120 L168,92 Z",
  },
  {
    code: "GB-NIR",
    name: "Northern Ireland",
    dot: [80, 276],
    path: "M58,252 L84,240 L108,256 L104,288 L80,312 L52,292 Z",
  },
  {
    code: "GB-WLS",
    name: "Wales",
    dot: [178, 300],
    path: "M206,250 L178,252 L150,278 L160,312 L196,352 L206,372 Z",
  },
  {
    code: "GB-ENG",
    name: "England",
    dot: [238, 300],
    path: "M232,178 L248,214 L262,250 L286,300 L270,330 L298,392 L250,388 L232,404 L188,408 L150,412 L92,432 L140,404 L176,380 L206,372 L206,250 L214,214 L206,196 Z",
  },
];

export function CoverageMap() {
  const live = REGIONS.filter((region) => isDealReady(region.code));
  const capped = REGIONS.filter((region) => !isDealReady(region.code));

  return (
    <section className="mt-16 rounded-2xl border hairline bg-surface-1 px-6 py-6">
      <span className="eyebrow">Where Lode operates</span>
      <h2 className="mt-2 font-display text-xl text-ink-100">The map is jurisdictions, not addresses</h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-400">
        Lode is live wherever its rate tables are verified. A deal is scored
        after the right transfer tax and the right obligations for the nation it
        sits in — so coverage is a question of which legal jurisdiction has been
        checked, not of where any one property is. We never plot a seller&rsquo;s
        location on a public page.
      </p>

      <div className="mt-6 grid items-center gap-8 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <svg
          viewBox="0 0 360 480"
          role="img"
          aria-label="Coverage map of the United Kingdom: England, Scotland and Northern Ireland live; Wales capped."
          className="mx-auto h-auto w-full max-w-[280px]"
        >
          {REGIONS.map((region) => {
            const isLive = isDealReady(region.code);
            return (
              <path
                key={region.code}
                d={region.path}
                fill={isLive ? "var(--color-lode-400)" : "var(--color-surface-2)"}
                fillOpacity={isLive ? 0.18 : 1}
                stroke={isLive ? "var(--color-lode-400)" : "var(--color-ink-600)"}
                strokeOpacity={isLive ? 0.75 : 1}
                strokeWidth={1.4}
                strokeLinejoin="round"
                strokeDasharray={isLive ? undefined : "4 3"}
              />
            );
          })}
          {live.map((region) => (
            <circle
              key={region.code}
              cx={region.dot[0]}
              cy={region.dot[1]}
              r={3.5}
              fill="var(--color-lode-300)"
            />
          ))}
        </svg>

        <div>
          <ul className="grid gap-1 overflow-hidden rounded-2xl border hairline bg-hairline">
            {[...live, ...capped].map((region) => {
              const isLive = isDealReady(region.code);
              return (
                <li
                  key={region.code}
                  className="flex min-w-0 items-center justify-between gap-3 bg-surface-1 px-4 py-3"
                >
                  <span className="flex items-center gap-2.5 text-sm text-ink-100">
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor: isLive ? "var(--color-lode-400)" : "var(--color-ink-600)",
                      }}
                    />
                    {region.name}
                  </span>
                  <span className={isLive ? "text-xs text-lode-300" : "text-xs text-ink-500"}>
                    {isLive ? "Live" : "Capped"}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-ink-500">
            England, Scotland and Northern Ireland are live. Wales is modelled but
            its Land Transaction Tax bands are not yet verified, so Welsh deals are
            capped rather than scored as ready — the engine refuses a figure it
            cannot stand behind.
          </p>
        </div>
      </div>
    </section>
  );
}

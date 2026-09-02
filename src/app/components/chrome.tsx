import Link from "next/link";
import type { TradeReferralReport } from "@shared/domain/partners";
import type { Verdict } from "@shared/domain/types";

/**
 * Shared chrome.
 *
 * Everything visual that more than one page needs lives here: the mark, the
 * header, the verdict vocabulary and the score colour scale. These had each
 * been re-implemented per page, which meant a verdict could be labelled
 * "Negotiate" in one place and "Renegotiate" in another, and the logo drifted
 * between four copies. One definition each, imported everywhere.
 *
 * Tailwind class helpers live here rather than in lib/format because they are
 * presentation, and lib/format is imported by the domain layer.
 */

/** Colour for a 0-100 score. The thresholds match the verdict bands. */
export function scoreTone(value: number): string {
  if (value >= 78) return "text-emerald-400";
  if (value >= 60) return "text-amber-400";
  if (value >= 40) return "text-orange-400";
  return "text-red-400";
}

export function scoreBg(value: number): string {
  if (value >= 78) return "bg-emerald-500";
  if (value >= 60) return "bg-amber-500";
  if (value >= 40) return "bg-orange-500";
  return "bg-red-500";
}

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden>
      <path d="M13 2 3 8v10l10 6 10-6V8L13 2Z" stroke="var(--color-lode-400)" strokeWidth="1.3" />
      <path d="M8 11.5 13 8.5l5 3v5.5l-5 3-5-3v-5.5Z" fill="var(--color-lode-400)" fillOpacity="0.22" />
      <path
        d="M13 8.5v9M8 11.5l10 5.5M18 11.5 8 17"
        stroke="var(--color-lode-400)"
        strokeWidth="0.9"
        strokeOpacity="0.75"
      />
    </svg>
  );
}

/**
 * `rule` is written out rather than derived from `text`.
 *
 * Tailwind reads the source for class names; a class built at runtime by
 * string surgery on another class never reaches the stylesheet, so the border
 * silently fell back to the default grey. Static strings, one per verdict.
 */
export const VERDICT_TONE: Record<
  Verdict,
  { label: string; chip: string; text: string; rule: string }
> = {
  proceed: {
    label: "Proceed",
    chip: "border-emerald-600/45 bg-emerald-500/10 text-emerald-300",
    text: "text-emerald-300",
    rule: "border-emerald-500/80",
  },
  negotiate: {
    label: "Negotiate",
    chip: "border-amber-600/45 bg-amber-500/10 text-amber-300",
    text: "text-amber-300",
    rule: "border-amber-500/80",
  },
  restructure: {
    label: "Restructure",
    chip: "border-orange-600/45 bg-orange-500/10 text-orange-300",
    text: "text-orange-300",
    rule: "border-orange-500/80",
  },
  reject: {
    label: "Walk away",
    chip: "border-red-600/45 bg-red-500/10 text-red-300",
    text: "text-red-300",
    rule: "border-red-500/80",
  },
};

/**
 * Page header.
 *
 * `width` matches the page's own container so the header rule lines up with
 * the content beneath it. `trailing` carries whatever that page needs on the
 * right — a reference, a score, a nav.
 */
export function SiteHeader({
  width = "max-w-6xl",
  sticky = false,
  back = "/",
  trailing,
  children,
}: {
  width?: string;
  sticky?: boolean;
  back?: string;
  trailing?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header
      className={`app-header border-b hairline ${sticky ? "sticky top-0 z-40 bg-ink-950/85 backdrop-blur-xl" : ""}`}
    >
      <div className={`mx-auto flex ${width} items-center justify-between gap-6 px-6 py-3`}>
        <div className="flex min-w-0 items-center gap-3.5">
          <Link href={back} className="flex shrink-0 items-center gap-2.5">
            <Mark size={19} />
            <span className="font-display text-[17px] tracking-[-0.01em] text-ink-100">Lode</span>
          </Link>
          {children}
        </div>
        {trailing !== undefined && <div className="flex items-center gap-2.5">{trailing}</div>}
      </div>
    </header>
  );
}

/**
 * A panel.
 *
 * The eyebrow is grey rather than gold. Gold on every panel header meant four
 * or five gold labels on a page, which is not emphasis — it is a background
 * colour that happens to spell words. The accent is kept for the figures.
 */
export function Panel({
  title,
  eyebrow,
  action,
  children,
  className = "",
  flush = false,
}: {
  title?: string;
  eyebrow?: string;
  /** Rendered at the right of the header: a link, a count, a control. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Drop the body padding, for a panel whose child is a table. */
  flush?: boolean;
}) {
  return (
    <section className={`overflow-hidden rounded-xl border hairline bg-surface-1 ${className}`}>
      {(title !== undefined || eyebrow !== undefined) && (
        <div className="flex items-baseline justify-between gap-4 border-b hairline px-5 py-3.5">
          <div>
            {eyebrow !== undefined && <span className="eyebrow">{eyebrow}</span>}
            {title !== undefined && (
              <h2 className={`font-display text-[17px] leading-tight text-ink-100 ${eyebrow !== undefined ? "mt-1.5" : ""}`}>
                {title}
              </h2>
            )}
          </div>
          {action !== undefined && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={flush ? "" : "px-5 py-4"}>{children}</div>
    </section>
  );
}

/**
 * A button, in three weights.
 *
 * Every page had been writing its own, which is how one ended up with a 24px
 * radius and its neighbour with 8px. Renders as a `button` or, given `href`, as
 * a link that looks identical — the two are visually the same control and were
 * previously drifting apart.
 */
export function Button({
  children,
  variant = "secondary",
  size = "md",
  href,
  className = "",
  ...rest
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  href?: string;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors duration-100";
  const sizing = size === "sm" ? "h-8 px-3 text-[13px]" : "h-9.5 px-4 text-sm";
  const look = {
    // The gold is a fill, not a glow. A shadow under a bright button on a dark
    // ground reads as a sticker; a flat fill reads as a control.
    primary: "bg-lode-400 text-ink-950 hover:bg-lode-300 active:bg-lode-500",
    secondary:
      "border hairline bg-surface-2 text-ink-100 hover:border-ink-600 hover:bg-surface-3",
    ghost: "text-ink-300 hover:bg-surface-2 hover:text-ink-100",
  }[variant];

  const classes = `${base} ${sizing} ${look} ${className}`;
  if (href !== undefined) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}

/** A small status chip. Squared, because a pill reads as marketing. */
export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "good" | "warn" | "bad";
  className?: string;
}) {
  const look = {
    neutral: "border-ink-700 bg-ink-850 text-ink-300",
    accent: "border-lode-500/45 bg-lode-500/10 text-lode-200",
    good: "border-emerald-600/45 bg-emerald-500/10 text-emerald-300",
    warn: "border-amber-600/45 bg-amber-500/10 text-amber-300",
    bad: "border-red-600/45 bg-red-500/10 text-red-300",
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase leading-[1.4] tracking-[0.08em] ${look} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * A figure with its label.
 *
 * Label above, small and quiet; the figure below in tabular numerals so a
 * column of these lines up. The unit or qualifier goes under, not beside — a
 * qualifier on the same baseline competes with the number for the first read.
 */
export function Stat({
  label,
  value,
  note,
  warn,
  tone,
  size = "md",
}: {
  label: string;
  value: string;
  note?: string;
  /** Red, for a figure whose sign is the finding. */
  warn?: boolean;
  tone?: string;
  size?: "sm" | "md" | "lg";
}) {
  const scale = { sm: "text-[17px]", md: "text-[21px]", lg: "text-[30px]" }[size];
  const colour = warn === true ? "text-red-300" : (tone ?? "text-ink-100");
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.09em] text-ink-400">{label}</p>
      <p className={`tnum mt-1 ${scale} leading-none ${colour}`}>{value}</p>
      {note !== undefined && <p className="mt-1.5 text-[11px] leading-snug text-ink-500">{note}</p>}
    </div>
  );
}

export function KeyValue({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b hairline py-2 last:border-0">
      <dt className="text-[13px] text-ink-400">{k}</dt>
      <dd className={`tnum text-[13px] ${tone ?? "text-ink-100"}`}>{v}</dd>
    </div>
  );
}

/**
 * Trade partner referrals.
 *
 * Rendered identically to a seller deciding whether to renovate instead of
 * selling and to a buyer pricing the works, because it is the same
 * introduction and it carries the same disclosure obligation either way. The
 * disclosure comes from the referral, never from this component — a surface
 * must not be able to show the introduction without the interest behind it.
 */
export function TradeReferrals({
  report,
  heading,
  intro,
}: {
  report: TradeReferralReport;
  heading: string;
  intro: string;
}) {
  if (report.referrals.length === 0) return null;

  return (
    <section className="mt-6 rounded-2xl border hairline bg-surface-1 px-5 py-4">
      <p className="eyebrow">{heading}</p>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-300">{intro}</p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {report.referrals.map(({ partner, reasons, disclosure }) => (
          <div
            key={partner.key}
            className="flex flex-col rounded-xl border hairline bg-ink-950/40 px-5 py-4"
          >
            <p className="font-display text-lg text-ink-100">{partner.name}</p>
            <p className="mt-0.5 text-xs text-lode-300">{partner.remit}</p>

            <ul className="mt-3 space-y-2">
              {reasons.map((r) => (
                <li key={r} className="flex gap-2.5 text-sm leading-relaxed text-ink-300">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-lode-400" />
                  {r}
                </li>
              ))}
            </ul>

            <a
              href={partner.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-lg border border-lode-400/40 px-3.5 py-2 text-sm text-lode-200 transition hover:border-lode-400 hover:bg-lode-400/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lode-400"
            >
              Visit {partner.name}
              <span aria-hidden="true">&rarr;</span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>

            <p className="mt-4 border-t hairline pt-3 text-xs leading-relaxed text-ink-400">
              {disclosure}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

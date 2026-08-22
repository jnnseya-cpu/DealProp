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

export const VERDICT_TONE: Record<Verdict, { label: string; chip: string; text: string }> = {
  proceed: {
    label: "Proceed",
    chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    text: "text-emerald-300",
  },
  negotiate: {
    label: "Negotiate",
    chip: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    text: "text-amber-300",
  },
  restructure: {
    label: "Restructure",
    chip: "border-orange-500/40 bg-orange-500/10 text-orange-300",
    text: "text-orange-300",
  },
  reject: {
    label: "Walk away",
    chip: "border-red-500/40 bg-red-500/10 text-red-300",
    text: "text-red-300",
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
      className={`border-b hairline ${sticky ? "sticky top-0 z-40 bg-ink-950/85 backdrop-blur-xl" : ""}`}
    >
      <div className={`mx-auto flex ${width} items-center justify-between px-6 py-4`}>
        <div className="flex items-center gap-4">
          <Link href={back} className="flex items-center gap-3">
            <Mark />
            <span className="font-display text-lg text-ink-100">Lode</span>
          </Link>
          {children}
        </div>
        {trailing !== undefined && <div className="flex items-center gap-3">{trailing}</div>}
      </div>
    </header>
  );
}

export function Panel({
  title,
  eyebrow,
  children,
  className = "",
}: {
  title?: string;
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border hairline bg-ink-900/40 ${className}`}>
      {(title !== undefined || eyebrow !== undefined) && (
        <div className="border-b hairline px-6 py-4">
          {eyebrow !== undefined && (
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-lode-400">
              {eyebrow}
            </span>
          )}
          {title !== undefined && (
            <h2 className="mt-1 font-display text-xl text-ink-100">{title}</h2>
          )}
        </div>
      )}
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

export function KeyValue({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-ink-400">{k}</dt>
      <dd className={`tnum text-sm ${tone ?? "text-ink-100"}`}>{v}</dd>
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
    <section className="mt-6 rounded-2xl border hairline bg-ink-900/40 px-6 py-6">
      <p className="text-[11px] uppercase tracking-[0.12em] text-ink-400">{heading}</p>
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

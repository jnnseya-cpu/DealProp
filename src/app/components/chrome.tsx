import type { Verdict } from "@/domain/types";

/** Shared chrome, so the mark and the verdict vocabulary cannot drift by page. */

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

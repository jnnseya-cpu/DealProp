import Link from "next/link";
import { Panel, SiteHeader } from "@/app/components/chrome";
import { requireOperator } from "@/app/operator/guard";
import { PROHIBITIONS } from "@shared/domain/prohibitions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Conduct — Lode" };

/**
 * The twelve things this platform must not do, and what stops each one.
 *
 * On the operator side rather than in a document, because the useful version
 * of this list is the one somebody can check against the code. Each rule shows
 * the control that refuses; a test walks these citations and fails if one
 * names a function nobody wrote, which is the failure mode of every compliance
 * register — a note that reads as a control and is not one.
 */
export default async function ConductPage() {
  await requireOperator("/operator/conduct");

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        back="/operator"
        trailing={
          <nav className="flex items-center gap-5 text-[13px] text-ink-400">
            <Link href="/operator/audit" className="transition-colors hover:text-ink-100">
              Audit
            </Link>
            <Link href="/operator/billing" className="transition-colors hover:text-ink-100">
              Billing
            </Link>
          </nav>
        }
      />

      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="eyebrow">Conduct</p>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {PROHIBITIONS.length} things this platform must not do
        </h1>
        <p className="mt-4 max-w-[38rem] text-[14px] leading-[1.6] text-ink-400">
          Each one names the control that refuses. A prohibition with nothing behind it is a
          sentence in a document, so a test walks these citations and fails if one names a function
          nobody wrote — which is the failure mode of every compliance register.
        </p>

        <div className="mt-9 space-y-4">
          {PROHIBITIONS.map((rule) => (
            <article
              key={rule.key}
              className="rounded-r-lg border-y border-r border-l-2 border-l-lode-400/70 hairline bg-surface-1 px-5 py-4"
            >
              <h2 className="font-display text-[17px] leading-tight text-ink-100">{rule.rule}</h2>
              <p className="mt-2 text-[13px] leading-[1.6] text-ink-400">{rule.why}</p>
              <ul className="mt-3.5 space-y-1.5 border-t hairline pt-3.5">
                {rule.enforcedBy.map((note) => (
                  <li key={note} className="font-mono text-[12px] leading-[1.6] text-ink-500">
                    {note}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}

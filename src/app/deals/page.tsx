import Link from "next/link";
import { listDeals } from "@/store/repository";
import { scoreDeal } from "@/domain/dealScore";
import { toWorkingDeal } from "@/domain/workingDeal";
import { gbp, gbpSigned, percent } from "@/lib/format";
import { scoreTone, SiteHeader, VERDICT_TONE } from "@/app/components/chrome";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Deals — Lode",
  description: "Every opportunity, scored after tax and stress-tested before it reaches capital.",
};

/**
 * Deal index.
 *
 * Sorted by score, with blocked deals shown rather than hidden. A pipeline that
 * quietly drops the deals the protection engine stopped would let the same
 * property be re-entered and re-offered, which is precisely the outcome the
 * block exists to prevent.
 */
export default async function DealsPage() {
  const records = await listDeals();

  const rows = records
    .map((record) => {
      const working = toWorkingDeal(record.inputs);
      const scored = scoreDeal(working.inputs);
      return { record, working, scored };
    })
    .sort((a, b) => b.scored.breakdown.composite - a.scored.breakdown.composite);

  return (
    <main className="min-h-screen">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/deals" className="text-ink-100">Deals</Link>
            <Link href="/sell" className="transition hover:text-ink-100">Sell</Link>
          </nav>
        }
      />

      <div className="mx-auto max-w-6xl px-6 py-14">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">Pipeline</span>
        <h1 className="mt-4 font-display text-4xl leading-tight text-ink-100 sm:text-5xl">
          {rows.length} {rows.length === 1 ? "opportunity" : "opportunities"}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-400">
          Every deal is appraised after tax and shocked by the same nine stress scenarios before it
          reaches capital. Scores are comparable across the pipeline because the tests are identical.
        </p>

        <div className="mt-12 space-y-3">
          {rows.map(({ record, working, scored }) => {
            const verdict = VERDICT_TONE[scored.verdict];
            return (
              <Link
                key={record.id}
                href={`/deals/${record.id}`}
                className="group block rounded-2xl border hairline bg-ink-900/40 px-6 py-5 transition hover:border-ink-400 hover:bg-ink-900/70"
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-mono text-xs text-ink-500">{record.reference}</span>
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.1em] ${verdict.chip}`}>
                        {verdict.label}
                      </span>
                      {scored.protection.blocked && (
                        <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.1em] text-red-300">
                          Blocked
                        </span>
                      )}
                      {working.modelled && (
                        <span className="rounded-full border hairline px-2.5 py-0.5 text-[10px] uppercase tracking-[0.1em] text-ink-400">
                          No price agreed
                        </span>
                      )}
                    </div>
                    <p className="mt-2 font-display text-xl text-ink-100">
                      {record.property.bedrooms}-bed {record.property.propertyType} ·{" "}
                      {record.property.locality}
                    </p>
                    <p className="mt-1 text-xs text-ink-400">
                      {record.property.postcodeArea} · {gbp(working.inputs.purchasePrice)} ·{" "}
                      {percent(scored.appraisal.marginOnGdvBps)} margin ·{" "}
                      {gbpSigned(scored.appraisal.profit)} after tax
                    </p>
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className={`tnum font-display text-3xl ${scoreTone(scored.breakdown.composite)}`}>
                        {scored.breakdown.composite}
                      </p>
                      <p className="text-[10px] uppercase tracking-[0.1em] text-ink-500">Deal score</p>
                    </div>
                    <span className="text-ink-600 transition group-hover:text-lode-300" aria-hidden>
                      →
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {rows.length === 0 && (
          <p className="mt-12 rounded-2xl border hairline bg-ink-900/40 px-6 py-8 text-sm text-ink-400">
            No deals yet. Run <code className="text-ink-200">npm run seed</code>, or submit an
            enquiry through <Link href="/sell" className="text-lode-300 underline">the seller form</Link>.
          </p>
        )}
      </div>
    </main>
  );
}

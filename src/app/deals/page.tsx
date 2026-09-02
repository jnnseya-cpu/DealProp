import Link from "next/link";
import { listDeals } from "@backend/store/repository";
import { scoreDeal } from "@shared/domain/dealScore";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { gbp, gbpSigned, percent } from "@shared/format";
import { Badge, scoreTone, SiteHeader, VERDICT_TONE } from "@/app/components/chrome";
import { requireOperator } from "@/app/operator/guard";
import { SignOutButton } from "@/app/operator/SignOutButton";

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
  await requireOperator("/deals");
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
          <nav className="flex items-center gap-5 text-[13px] text-ink-400">
            <Link href="/deals" className="text-ink-100">Deals</Link>
            <Link href="/portfolio" className="transition hover:text-ink-100">Portfolio</Link>
            <Link href="/invest" className="transition-colors hover:text-ink-100">Buy</Link>
            <Link href="/capital" className="transition-colors hover:text-ink-100">Capital</Link>
            <SignOutButton />
          </nav>
        }
      />

      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="eyebrow">Pipeline</p>
            <h1 className="mt-2.5 font-display text-[32px] leading-tight text-ink-100">
              {rows.length} {rows.length === 1 ? "opportunity" : "opportunities"}
            </h1>
          </div>
          <p className="max-w-md text-[13px] leading-[1.6] text-ink-400">
            Appraised after tax and shocked by the same nine stress scenarios before reaching
            capital. Scores are comparable across the pipeline because the tests are identical.
          </p>
        </div>

        {/*
          A table, because this is tabular.
          
          These were four cards a thousand pixels wide with the reference at one
          end and the score at the other, which put the two figures a reader
          compares furthest apart and made four deals fill a screen. A column of
          right-aligned tabular figures can be scanned; a stack of cards has to
          be read one at a time.
        */}
        {rows.length > 0 && (
          <div className="mt-8 overflow-x-auto rounded-xl border hairline bg-surface-1">
            <table className="w-full border-collapse text-left md:min-w-[820px]">
              <thead>
                <tr className="border-b hairline bg-surface-2">
                  <Th className="w-[112px]">Ref</Th>
                  <Th>Property</Th>
                  <Th className="num hidden md:table-cell">Price</Th>
                  <Th className="num hidden lg:table-cell">Margin</Th>
                  <Th className="num hidden md:table-cell">After tax</Th>
                  <Th className="hidden w-[150px] sm:table-cell">Verdict</Th>
                  <Th className="num w-[74px]">Score</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ record, working, scored }) => {
                  const verdict = VERDICT_TONE[scored.verdict];
                  const profit = scored.appraisal.profit;
                  return (
                    <tr key={record.id} className="row-hover border-b hairline last:border-0">
                      <Td>
                        <Link
                          href={`/deals/${record.id}`}
                          className="font-mono text-[12px] text-ink-400 transition-colors hover:text-lode-300"
                        >
                          {record.reference}
                        </Link>
                      </Td>
                      <Td>
                        <Link href={`/deals/${record.id}`} className="group block">
                          <span className="text-[14px] text-ink-100 transition-colors group-hover:text-lode-200">
                            {record.property.bedrooms}-bed {record.property.propertyType} ·{" "}
                            {record.property.locality}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-500">
                            {record.property.postcodeArea}
                            <span className="tnum sm:hidden">{gbp(working.inputs.purchasePrice)}</span>
                            {working.modelled && <Badge>No price agreed</Badge>}
                            {scored.protection.blocked && <Badge tone="bad">Blocked</Badge>}
                          </span>
                        </Link>
                      </Td>
                      <Td className="num tnum hidden text-[13px] text-ink-200 md:table-cell">
                        {gbp(working.inputs.purchasePrice)}
                      </Td>
                      <Td className="num tnum hidden text-[13px] text-ink-200 lg:table-cell">
                        {percent(scored.appraisal.marginOnGdvBps)}
                      </Td>
                      <Td
                        className={`num tnum hidden text-[13px] md:table-cell ${profit < 0 ? "text-red-300" : "text-ink-200"}`}
                      >
                        {gbpSigned(profit)}
                      </Td>
                      <Td className="hidden sm:table-cell">
                        <span className={`inline-flex rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] ${verdict.chip}`}>
                          {verdict.label}
                        </span>
                      </Td>
                      <Td className={`num tnum text-[19px] ${scoreTone(scored.breakdown.composite)}`}>
                        {scored.breakdown.composite}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.length === 0 && (
          <p className="mt-8 rounded-xl border hairline bg-surface-1 px-5 py-7 text-[13px] text-ink-400">
            No deals yet. Run <code className="font-mono text-ink-200">npm run seed</code>, or submit
            an enquiry through{" "}
            <Link href="/sell" className="text-lode-300 underline underline-offset-2">
              the seller form
            </Link>
            .
          </p>
        )}
      </div>
    </main>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.09em] text-ink-500 ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

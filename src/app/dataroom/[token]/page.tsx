import { notFound } from "next/navigation";
import { getDeal } from "@backend/store/repository";
import { openDataRoom } from "@backend/outreach/stages";
import { audit } from "@backend/audit";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { runDealDirector } from "@shared/domain/director";
import { fundingMetrics } from "@shared/domain/fundingMetrics";
import { borrowingReport } from "@shared/domain/borrowing";
import { gbp, percent } from "@shared/format";
import { bps, ZERO } from "@shared/money";
import { UK_INVESTOR_CATEGORISATION } from "@shared/domain/jurisdictions/uk-financial-promotion";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Deal pack — Lode",
  robots: { index: false, follow: false },
};

/**
 * The data room: one funder's time-limited view of one deal.
 *
 * Reached by a capability URL, like the seller's own result page — the token is
 * the credential, generated from a CSPRNG and never derived from anything
 * guessable about the deal. It expires on its own, so forgetting to withdraw it
 * is not the same as leaving it open for ever.
 *
 * Every page carries the recipient's name and the moment it was produced. That
 * is the watermark: a copy that circulates says who it was given to, which is
 * the only realistic deterrent when the content is a page somebody can
 * screenshot.
 *
 * What it deliberately does not contain: anything the seller told us about
 * themselves. A funder needs the asset, the numbers and the exit. The seller's
 * situation was given to us to get them help.
 */
export default async function DataRoomPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const check = await openDataRoom(token);

  if (!check.valid || check.grant === undefined) {
    return (
      <main className="mx-auto max-w-xl px-6 py-24">
        <h1 className="font-display text-3xl text-ink-100">Not available</h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-300">{check.reason}</p>
      </main>
    );
  }

  const grant = check.grant;
  const record = await getDeal(grant.dealId);
  if (record === undefined) notFound();

  await audit("viewed-deal-material", {
    email: grant.organisationName,
    subject: record.id,
    detail: `Data room opened (grant ${grant.token.slice(0, 8)}…, opening ${grant.accessCount + 1}).`,
  });

  const working = toWorkingDeal(record.inputs);
  const briefing = runDealDirector(working.inputs);
  const appraisal = briefing.scored.appraisal;
  const metrics = fundingMetrics(appraisal, record.evidence?.committedCash);
  const borrowing = borrowingReport(appraisal);
  const producedAt = new Date().toISOString();

  return (
    <main className="min-h-screen bg-ink-950">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="rounded-lg border-l-2 border-lode-500/80 bg-surface-1 px-6 py-4">
          <p className="eyebrow">
            Prepared for {grant.organisationName}
          </p>
          <p className="mt-1 font-mono text-[11px] text-ink-500">
            {producedAt.replace("T", " ").slice(0, 16)} · access expires{" "}
            {grant.expiresAt.slice(0, 10)} · opening {grant.accessCount + 1}
          </p>
        </div>

        <p className="mt-6 rounded-2xl border hairline bg-surface-1 px-5 py-4 text-xs leading-relaxed text-ink-400">
          This is a description of an opportunity to lend against property, prepared for a business
          recipient. It is not advice, not a valuation and not an offer. Figures are our own
          appraisal and are estimates: property values can fall, works can overrun and an exit may
          take longer than modelled, in which case a return would be lower or capital could be lost.
          Lode is not authorised by the Financial Conduct Authority. Investor categorisation rules
          as at {UK_INVESTOR_CATEGORISATION.asOf}.
        </p>

        <h1 className="mt-10 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {record.reference}
        </h1>
        <p className="mt-2 text-sm text-ink-400">
          {record.inputs.property.bedrooms}-bed {record.inputs.property.propertyType},{" "}
          {record.inputs.property.tenure}, {record.inputs.property.locality} (
          {record.inputs.property.postcodeArea})
        </p>

        <Block title="The transaction">
          <Row label="Purchase price" value={gbp(record.inputs.purchasePrice)} />
          <Row label="Independent open-market value" value={gbp(record.inputs.property.openMarketValue)} />
          <Row label="Works budget" value={gbp(record.inputs.property.refurbishmentEstimate)} />
          <Row label="Value on completion of works" value={gbp(record.inputs.property.postWorksValue)} />
          <Row label="Term" value={`${record.inputs.holdMonths} months`} />
          <Row label="Exit" value={record.inputs.exit.replace(/-/g, " ")} />
        </Block>

        <Block title="The facility">
          <Row label="Facility sought" value={gbp(borrowing.advance.facility)} />
          <Row label="Deducted at drawdown" value={gbp(borrowing.advance.deducted)} />
          <Row label="Reaches completion" value={gbp(borrowing.advance.received)} />
          <Row label="Total cost of borrowing" value={gbp(borrowing.cost.total)} />
        </Block>

        <Block title="The ratios">
          {metrics.metrics.map((metric) => (
            <Row
              key={metric.key}
              label={metric.label}
              value={
                metric.display === "amount"
                  ? gbp(metric.amount ?? ZERO)
                  : metric.display === "times"
                    ? `${((metric.bps ?? 0) / 10_000).toFixed(2)}×`
                    : percent(metric.bps ?? bps(0))
              }
            />
          ))}
        </Block>

        <Block title="Why we think it works, and where it does not">
          <p className="text-sm leading-relaxed text-ink-300">{briefing.headline}</p>
          <ul className="mt-4 space-y-2">
            {briefing.scored.redTeam.results.slice(0, 6).map((result) => (
              <li key={result.stress.label} className="text-sm leading-relaxed text-ink-400">
                <span className="text-ink-200">{result.stress.label}</span> — profit{" "}
                {gbp(result.profit)}
                {result.losesCapital
                  ? ", which loses capital"
                  : result.wipesOutProfit
                    ? ", which wipes out the profit"
                    : ""}
              </li>
            ))}
          </ul>
          {briefing.scored.redTeam.singleFactorLosses.length > 0 && (
            <p className="mt-4 text-sm leading-relaxed text-amber-300">
              Loses money if any one of these moves alone:{" "}
              {briefing.scored.redTeam.singleFactorLosses.join(", ")}.
            </p>
          )}
        </Block>

        <p className="mt-10 font-mono text-[11px] text-ink-600">
          Prepared for {grant.organisationName} at {producedAt.replace("T", " ").slice(0, 16)}. This
          page is individual to you and is logged. Access ends {grant.expiresAt.slice(0, 10)}.
        </p>
      </div>
    </main>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 rounded-2xl border hairline bg-surface-1 px-5 py-4">
      <h2 className="eyebrow">{title}</h2>
      <dl className="mt-4 space-y-2">{children}</dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6">
      <dt className="text-sm text-ink-300">{label}</dt>
      <dd className="font-mono text-sm text-ink-100">{value}</dd>
    </div>
  );
}

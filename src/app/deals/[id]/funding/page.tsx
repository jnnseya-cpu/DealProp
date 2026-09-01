import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/app/components/chrome";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { audit } from "@backend/audit";
import { getDeal } from "@backend/store/repository";
import { operatorPermissions } from "@backend/permissions";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { appraise } from "@shared/domain/economics";
import { borrowingReport } from "@shared/domain/borrowing";
import { fundingMetrics } from "@shared/domain/fundingMetrics";
import { fundingReadiness } from "@shared/domain/fundingReadiness";
import { classifyRoute } from "@shared/domain/regulatoryRoute";
import { gbp, percent } from "@shared/format";
import { EvidenceForm } from "./EvidenceForm";
import { BorrowerFactsForm } from "./BorrowerFactsForm";
import { OfferForm } from "./OfferForm";
import { compareRecordedOffers } from "@shared/domain/offers";
import { bps, ZERO } from "@shared/money";

export const dynamic = "force-dynamic";

export const metadata = { title: "Funding — Lode" };

/**
 * Whether this acquisition can be funded, and what is stopping it.
 *
 * Five questions in one place: is the pack ready, what will the borrowing
 * really cost, what actually arrives on the day, what ratios will a funder
 * decide on, and may an introduction lawfully be made at all.
 *
 * Everything here is computed from the deal and from what has been recorded
 * against it. Where nothing has been recorded the page says so rather than
 * scoring the absence of a problem as a clean bill of health — which is the
 * difference between a readiness score that is useful and one that is
 * flattering.
 */
export default async function FundingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requirePermission("view-seller-data", `/deals/${id}/funding`);
  const record = await getDeal(id);
  if (record === undefined) notFound();

  await audit("viewed-deal-material", {
    ...(viewerAccount(viewer) !== undefined ? { account: viewerAccount(viewer) } : {}),
    subject: record.id,
    detail: `${record.reference} (funding)`,
  });

  const working = toWorkingDeal(record.inputs);
  const appraisal = appraise(working.inputs);
  const borrowing = borrowingReport(appraisal);
  const comparison = compareRecordedOffers(working.inputs, record.offers ?? []);
  const metrics = fundingMetrics(appraisal, record.evidence?.committedCash);
  const route =
    record.borrowerFacts !== undefined
      ? classifyRoute(record.borrowerFacts, "unregulated-business-lender", operatorPermissions())
      : undefined;
  const readiness = fundingReadiness(appraisal, record.evidence ?? {}, route);

  const bandTone =
    readiness.band === "fundable-pack"
      ? "text-emerald-300"
      : readiness.band === "needs-work"
        ? "text-amber-300"
        : "text-red-300";

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/deals" className="transition hover:text-ink-100">Deals</Link>
            <Link href={`/deals/${record.id}`} className="transition hover:text-ink-100">Deal Room</Link>
            <Link href={`/deals/${record.id}/memorandum`} className="transition hover:text-ink-100">Memorandum</Link>
            <Link href={`/deals/${record.id}/agents`} className="transition hover:text-ink-100">Agents</Link>
          </nav>
        }
      />

      <div className="mx-auto max-w-4xl px-6 py-10">
        <span className="eyebrow">
          Funding · {record.reference}
        </span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          Finance readiness <span className={bandTone}>{readiness.score}</span>
          <span className="text-ink-600">/100</span>
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-400">{readiness.caveat}</p>

        {readiness.blockers.length > 0 && (
          <div className="mt-8 rounded-lg border-l-2 border-red-500/80 bg-surface-1 px-5 py-4">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-red-300">
              Stops this going to a funder
            </h2>
            <ul className="mt-3 space-y-2">
              {readiness.blockers.map((blocker) => (
                <li key={blocker} className="text-sm leading-relaxed text-red-200">{blocker}</li>
              ))}
            </ul>
          </div>
        )}

        {route !== undefined ? (
          <Section title="Regulatory route">
            <p className="font-mono text-xs text-lode-300">{route.route}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-300">{route.reason}</p>
            {route.blockers.map((b) => (
              <p key={b} className="mt-2 text-sm leading-relaxed text-amber-300">→ {b}</p>
            ))}
            <p className="mt-3 font-mono text-[11px] text-ink-600">
              Rules as at {route.rulesAsOf}. A technical control, not a legal determination.
            </p>
          </Section>
        ) : (
          <Section title="Regulatory route">
            <p className="text-sm leading-relaxed text-amber-300">
              Not classified. Until it is, no introduction may be made — an unclassified transaction
              routes to review, never to permitted.
            </p>
          </Section>
        )}

        <Section title="Borrower facts">
          <BorrowerFactsForm
            dealId={record.id}
            current={record.borrowerFacts as unknown as Record<string, unknown> | undefined}
          />
        </Section>

        <Section title="What the borrowing costs">
          <dl className="space-y-3">
            {borrowing.cost.lines.map((line) => (
              <div key={line.label} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <dt className="text-sm text-ink-200">
                  {line.label}
                  {line.deductedAtDrawdown && (
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-amber-400">
                      deducted at drawdown
                    </span>
                  )}
                  <span className="block max-w-xl text-xs leading-relaxed text-ink-500">{line.note}</span>
                </dt>
                <dd className="font-mono text-sm text-ink-100">{gbp(line.amount)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 border-t hairline pt-4 text-sm text-ink-200">
            Total over {borrowing.cost.termMonths} months:{" "}
            <span className="font-mono text-ink-100">{gbp(borrowing.cost.total)}</span>
            <span className="text-ink-500"> — {(borrowing.cost.costOfFacilityBps / 100).toFixed(1)}% of the facility</span>
          </p>
          {borrowing.warning !== undefined && (
            <p className="mt-3 text-sm leading-relaxed text-amber-300">{borrowing.warning}</p>
          )}
        </Section>

        <Section title="What actually arrives">
          <p className="text-sm leading-relaxed text-ink-300">{borrowing.advance.reason}</p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Figure label="Gross facility" value={gbp(borrowing.advance.facility)} />
            <Figure label="Deducted at drawdown" value={gbp(borrowing.advance.deducted)} tone="text-amber-300" />
            <Figure label="Reaches completion" value={gbp(borrowing.advance.received)} />
          </div>
        </Section>

        <Section title="The ratios a funder decides on">
          <dl className="space-y-4">
            {metrics.metrics.map((metric) => (
              <div key={metric.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-6">
                  <dt className="text-sm text-ink-200">{metric.label}</dt>
                  <dd className="font-mono text-sm text-ink-100">
                    {metric.display === "amount"
                      ? gbp(metric.amount ?? ZERO)
                      : metric.display === "times"
                        ? `${((metric.bps ?? 0) / 10_000).toFixed(2)}×`
                        : percent(metric.bps ?? bps(0))}
                  </dd>
                </div>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-500">
                  Against {metric.against}. {metric.reason}
                </p>
              </div>
            ))}
          </dl>
          <p className="mt-5 font-mono text-[11px] text-ink-600">
            Formula version {metrics.formulaVersion}
          </p>
        </Section>

        <Section title="Offers received">
          <p className="text-sm leading-relaxed text-ink-300">{comparison.summary}</p>
          {comparison.offers.length > 0 && (
            <ul className="mt-4 space-y-3">
              {comparison.offers.map((offer) => (
                <li key={offer.terms.id} className="rounded-xl border hairline px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6">
                    <p className="text-sm text-ink-100">
                      {offer.terms.lender}
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-ink-500">
                        {offer.confidence}
                      </span>
                    </p>
                    <p className="font-mono text-xs text-ink-300">
                      total {gbp(offer.cost.total)}
                      <span className="text-ink-600"> · </span>
                      advance {gbp(offer.netAdvance)}
                      <span className="text-ink-600"> · </span>
                      sponsor {gbp(offer.sponsorCash)}
                    </p>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-ink-600">
                    {(offer.terms.annualRateBps / 100).toFixed(2)}% a year over {offer.terms.termMonths} months
                    {offer.terms.brokerFeeBps > 0 ? `, ${(offer.terms.brokerFeeBps / 100).toFixed(2)}% broker fee` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6 border-t hairline pt-6">
            <OfferForm dealId={record.id} />
          </div>
        </Section>

        <Section title="Record what can be proved">
          <EvidenceForm
            dealId={record.id}
            current={(record.evidence ?? {}) as unknown as Record<string, unknown>}
          />
        </Section>

        <Section title="What the pack still needs">
          <ul className="space-y-5">
            {readiness.components.map((component) => (
              <li key={component.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-6">
                  <p className="text-sm text-ink-200">{component.label}</p>
                  <p className="font-mono text-xs text-ink-400">
                    {component.earned}/{component.weight}
                  </p>
                </div>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-500">{component.reason}</p>
                {component.missing.map((item) => (
                  <p key={item} className="mt-1 text-sm leading-relaxed text-amber-300">→ {item}</p>
                ))}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 rounded-2xl border hairline bg-surface-1 px-5 py-4">
      <h2 className="eyebrow">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border hairline px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-500">{label}</p>
      <p className={`mt-1 font-mono text-lg ${tone ?? "text-ink-100"}`}>{value}</p>
    </div>
  );
}

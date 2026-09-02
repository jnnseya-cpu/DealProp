import Link from "next/link";
import { Badge, Panel, SiteHeader, Stat } from "@/app/components/chrome";
import { requirePermission } from "@/app/operator/guard";
import { portfolio } from "@backend/portfolio";
import {
  refinanceWindow,
  releaseEstimate,
  REFINANCE_LEAD_DAYS,
  SEASONING_MONTHS,
} from "@shared/domain/portfolio";
import { gbp, gbpSigned, percent, titleCase } from "@shared/format";
import { pct, scale } from "@shared/money";
import { FacilityForm, RentForm, SaleForm, ValuationForm } from "./Forms";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Portfolio — Lode",
  description: "What is held, what it is worth, and when the money is due to be refinanced.",
};

/**
 * Portfolio OS.
 *
 * The last step of the workflow, and the one that decides whether this is a
 * marketplace or an operating system. A marketplace forgets a buyer the moment
 * they complete; this holds what they own, counts down to the facility end,
 * and says what comes out when it refinances.
 *
 * The design constraint everywhere on this page: a figure is evidenced or it
 * is an assumption, and the difference is printed. A holding nobody has
 * revalued shows its equity against what was paid, marked, rather than against
 * the appraisal's post-works projection — which would state as fact a number
 * that depends on works nobody has confirmed happened.
 */

/** A term lender's typical advance, for the release estimate. */
const REFINANCE_LTV = pct(75);

const WINDOW_TONE = {
  overdue: "text-red-300",
  urgent: "text-amber-300",
  open: "text-emerald-300",
  seasoning: "text-ink-300",
  unencumbered: "text-ink-400",
} as const;

export default async function PortfolioPage() {
  await requirePermission("view-seller-data", "/portfolio");

  const now = new Date();
  const { position, unrecorded, sold } = await portfolio(now);

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-5 text-[13px] text-ink-400">
            <Link href="/deals" className="transition-colors hover:text-ink-100">Deals</Link>
            <Link href="/portfolio" className="text-ink-100">Portfolio</Link>
            <Link href="/invest" className="transition-colors hover:text-ink-100">Buy Boxes</Link>
          </nav>
        }
      />

      <div className="mx-auto max-w-4xl px-6 py-10">
        <p className="eyebrow">Portfolio</p>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {position.holdings.length === 0
            ? "Nothing held yet"
            : `${gbp(position.totalEquity)} of equity across ${position.holdings.length}`}
        </h1>
        <p className="mt-4 max-w-[40rem] text-[14px] leading-[1.6] text-ink-400">
          {position.summary}
        </p>

        {position.holdings.length > 0 && (
          <div className="mt-8 grid grid-cols-2 gap-6 border-y hairline py-6 sm:grid-cols-4">
            <Stat label="Value" value={gbp(position.totalValue)} size="sm" />
            <Stat label="Debt" value={gbp(position.totalDebt)} size="sm" tone="text-ink-300" />
            <Stat label="Equity" value={gbp(position.totalEquity)} size="sm" />
            <Stat
              label="Net monthly"
              value={gbpSigned(position.monthlyNet)}
              size="sm"
              tone={position.monthlyNet >= 0 ? "text-emerald-300" : "text-amber-300"}
            />
          </div>
        )}

        {position.needingAttention.length > 0 && (
          <Panel
            className="mt-8"
            eyebrow="Now"
            title={`${position.needingAttention.length} ${position.needingAttention.length === 1 ? "facility needs" : "facilities need"} attention`}
            action={<Badge tone="warn">Refinance</Badge>}
          >
            <ul className="space-y-3">
              {position.needingAttention.map(({ holding, window }) => (
                <li key={holding.id} className="text-[13px] leading-[1.6]">
                  <span className="text-ink-100">{holding.reference}</span>{" "}
                  <span className={WINDOW_TONE[window.state]}>{window.advice}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <div className="mt-8 space-y-4">
          {position.holdings.map((held) => {
            const window = refinanceWindow(held.holding, now);
            const release = releaseEstimate(held.holding, REFINANCE_LTV);
            return (
              <article
                key={held.holding.id}
                className={`rounded-r-lg border-y border-r border-l-2 hairline bg-surface-1 px-5 py-4 ${
                  window.state === "overdue" || window.state === "urgent"
                    ? "border-l-amber-500/80"
                    : "border-l-ink-600"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="font-display text-[17px] leading-tight text-ink-100">
                    {held.holding.property.locality} · {held.holding.reference}
                  </h2>
                  <span className="tnum text-[16px] text-ink-100">{gbp(held.equity)}</span>
                </div>
                <p className="mt-1 text-[12px] text-ink-500">
                  {titleCase(held.holding.property.propertyType.replace(/-/g, " "))} ·{" "}
                  {held.holding.property.postcodeArea} · completed{" "}
                  {held.holding.completedAt.slice(0, 10)}
                </p>

                <dl className="mt-4 grid grid-cols-2 gap-4 border-y hairline py-4 sm:grid-cols-4">
                  <Stat label="Value" value={gbp(held.holding.currentValue)} size="sm" />
                  <Stat label="Cost" value={gbp(held.totalCost)} size="sm" tone="text-ink-300" />
                  <Stat label="LTV" value={percent(held.ltvBps, 0)} size="sm" tone="text-ink-300" />
                  <Stat
                    label="Yield on cost"
                    value={held.yieldOnCostBps > 0 ? percent(held.yieldOnCostBps, 1) : "not let"}
                    size="sm"
                    tone="text-ink-300"
                  />
                </dl>

                <p
                  className={`mt-3.5 border-l-2 py-1 pl-4 text-[13px] leading-[1.65] ${
                    held.restsOnAnUnverifiedValue
                      ? "border-amber-500/80 text-amber-200"
                      : "border-emerald-500/80 text-ink-300"
                  }`}
                >
                  {held.caveat}
                </p>

                <div className="mt-4 border-t hairline pt-4">
                  <p className="eyebrow">Refinance</p>
                  <p className={`mt-2 text-[13px] leading-[1.6] ${WINDOW_TONE[window.state]}`}>
                    {window.advice}
                  </p>
                  {window.state !== "unencumbered" && (
                    <p className="mt-2 text-[13px] leading-[1.6] text-ink-400">
                      At {percent(REFINANCE_LTV, 0)} it would advance {gbp(release.newFacility)},{" "}
                      {release.shortfall
                        ? `which is ${gbp(scale(release.released, -1))} short of clearing the existing debt.`
                        : `releasing ${gbp(release.released)}.`}{" "}
                      <span className="text-ink-500">{release.basis} An estimate, not an offer.</span>
                    </p>
                  )}
                </div>

                <details className="mt-4 border-t hairline pt-4">
                  <summary className="cursor-pointer text-[13px] text-ink-500 transition-colors hover:text-ink-300">
                    Update what is known about it
                  </summary>
                  <div className="mt-4 space-y-5">
                    <ValuationForm dealId={held.holding.id} />
                    <div className="border-t hairline pt-4">
                      <FacilityForm dealId={held.holding.id} />
                    </div>
                    <div className="border-t hairline pt-4">
                      <RentForm dealId={held.holding.id} />
                    </div>
                    <div className="border-t hairline pt-4">
                      <SaleForm dealId={held.holding.id} />
                    </div>
                  </div>
                </details>
              </article>
            );
          })}
        </div>

        {unrecorded.length > 0 && (
          <Panel
            className="mt-8"
            eyebrow="Completed, not recorded"
            title={`${unrecorded.length} waiting`}
            action={<Badge tone="warn">Nothing known</Badge>}
          >
            <p className="text-[13px] leading-[1.65] text-ink-300">
              These completed and nothing has been recorded about holding them, so they are listed
              here rather than shown with invented figures. A property with no facility recorded is
              a property nobody is counting down — and the countdown is the point.
            </p>
            <ul className="mt-4 space-y-4 border-t hairline pt-4">
              {unrecorded.map((record) => (
                <li key={record.id} className="text-[13px] leading-[1.6]">
                  <Link
                    href={`/deals/${record.id}`}
                    className="text-ink-100 transition-colors hover:text-lode-300"
                  >
                    {record.reference}
                  </Link>
                  <div className="mt-2">
                    <ValuationForm dealId={record.id} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {sold.length > 0 && (
          <Panel className="mt-6" eyebrow="Sold" title={`${sold.length} out of the portfolio`}>
            <ul className="space-y-1.5">
              {sold.map((record) => (
                <li key={record.id} className="text-[13px] leading-[1.6] text-ink-400">
                  {record.reference} — sold {record.holding?.soldAt?.slice(0, 10)}
                </li>
              ))}
            </ul>
            <p className="mt-3.5 border-t hairline pt-3.5 text-[12px] leading-[1.6] text-ink-500">
              Marked, never deleted. A property that was held was held, and what it actually did is
              the thing that makes the next appraisal better than a model.
            </p>
          </Panel>
        )}

        <Panel className="mt-6" eyebrow="How the dates work" title="Seasoning, and the lead time">
          <p className="text-[13px] leading-[1.65] text-ink-300">
            Most term lenders will lend against the purchase price rather than a new valuation for
            the first {SEASONING_MONTHS} months, which is exactly what a refurbishment needs them
            not to do. And refinancing has to start {REFINANCE_LEAD_DAYS} days before the facility
            ends: a valuation takes a month to book and arrive, legals four to six weeks, and a
            lender&rsquo;s offer expires. Leaving it later is how a sponsor pays an extension fee on
            a case that was always going to refinance.
          </p>
        </Panel>
      </div>
    </main>
  );
}

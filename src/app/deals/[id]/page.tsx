import Link from "next/link";
import { notFound } from "next/navigation";
import { getDeal, listFundingBoxes, listBuyBoxes } from "@/store/repository";
import { runDealDirector } from "@/domain/director";
import { toWorkingDeal } from "@/domain/workingDeal";
import { buildCloseReport } from "@/domain/completion";
import { matchBuyBox, matchFundingBox, rankMatches, type MatchResult } from "@/domain/matching";
import { dealRevenue } from "@/domain/revenue";
import { referTradePartners } from "@/domain/partners";
import { SignOutButton } from "@/app/operator/SignOutButton";
import { add } from "@/lib/money";
import { gbp, gbpSigned, months, percent } from "@/lib/format";
import {
  KeyValue,
  Panel,
  scoreBg,
  scoreTone,
  SiteHeader,
  TradeReferrals,
  VERDICT_TONE,
} from "@/app/components/chrome";

export const dynamic = "force-dynamic";

/**
 * Deal Room.
 *
 * Everything on this page comes from one call to runDealDirector, so the
 * score, the memorandum and the seller-facing options cannot disagree. The
 * page decides layout and nothing else.
 *
 * Ordering is deliberate: the verdict and what would change it come first,
 * then the money, then the ways it fails, then who would fund it. A deal room
 * that leads with matched capital invites the reader to skip the part where
 * the deal is shown not to work.
 */
export default async function DealRoom({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getDeal(id);
  if (record === undefined) notFound();

  const working = toWorkingDeal(record.inputs);
  const briefing = runDealDirector(working.inputs);
  const { scored, stack, exits, recycle, strategies, diagnostics } = briefing;
  const a = scored.appraisal;

  const [fundingBoxes, buyBoxes] = await Promise.all([listFundingBoxes(), listBuyBoxes()]);
  const funders = rankMatches(
    fundingBoxes.map((b) => matchFundingBox(b, scored, record.borrowerCompletedDeals)),
  );
  const buyers = rankMatches(buyBoxes.map((b) => matchBuyBox(b, scored)));
  const rejectedFunders = fundingBoxes
    .map((b) => matchFundingBox(b, scored, record.borrowerCompletedDeals))
    .filter((m) => !m.eligible);

  const close = record.milestones !== undefined ? buildCloseReport(record.milestones) : undefined;
  const revenue = dealRevenue(a);
  const verdict = VERDICT_TONE[briefing.verdict];

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        sticky
        back="/deals"
        trailing={
          <>
            <span className={`rounded-full border px-3 py-1 text-xs ${verdict.chip}`}>
              {verdict.label}
            </span>
            <span className={`tnum font-display text-2xl ${scoreTone(scored.breakdown.composite)}`}>
              {scored.breakdown.composite}
            </span>
            <SignOutButton />
          </>
        }
      >
        <span className="font-mono text-xs text-ink-500">{record.reference}</span>
      </SiteHeader>

      <div className="mx-auto max-w-6xl px-6 py-12">
        {/* --- Headline ---------------------------------------------------- */}
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">
          Deal Room
        </span>
        <h1 className="mt-4 font-display text-4xl leading-tight text-ink-100 sm:text-5xl">
          {record.property.bedrooms}-bed {record.property.propertyType} in{" "}
          {record.property.locality}
        </h1>
        <p className="mt-3 text-sm text-ink-400">
          {record.property.postcodeArea} · {record.property.tenure} ·{" "}
          {diagnostics.situationLabel} · {months(working.inputs.holdMonths)} hold
        </p>

        {working.modelled && working.note !== undefined && (
          <div className="mt-6 rounded-xl border border-amber-500/25 bg-amber-500/5 px-5 py-4">
            <p className="text-sm text-amber-200/90">{working.note}</p>
          </div>
        )}

        {/*
          A protection block gets its own banner above the verdict rather than
          a line inside it. This deal cannot be shown to capital at all, and a
          reader who skims the reasons list must not be able to miss that.
        */}
        {scored.protection.blocked && (
          <div className="mt-8 rounded-2xl border border-red-500/40 bg-red-500/10 px-7 py-6">
            <p className="font-display text-2xl text-red-200">
              Blocked by the Seller Protection Engine
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-200">
              This deal cannot be shown to capital, matched to any mandate, or packaged until every
              item below is evidenced and a human reviewer has signed off.
            </p>
            <ul className="mt-5 space-y-4">
              {scored.protection.flags
                .filter((f) => f.severity === "block")
                .map((f) => (
                  <li key={f.key}>
                    <p className="text-sm text-ink-100">{f.label}</p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-400">{f.detail}</p>
                    <p className="mt-1 text-xs leading-relaxed text-red-300/90">{f.remedy}</p>
                  </li>
                ))}
            </ul>
          </div>
        )}

        <div className={`mt-6 rounded-2xl border px-7 py-6 ${verdict.chip}`}>
          <p className="font-display text-2xl leading-snug text-ink-100">{briefing.headline}</p>
          <ul className="mt-4 space-y-2">
            {briefing.reasons.map((r) => (
              <li key={r} className="flex gap-2.5 text-sm leading-relaxed text-ink-300">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-400" />
                {r}
              </li>
            ))}
          </ul>
        </div>

        {/* --- What would change the answer -------------------------------- */}
        {briefing.gatingActions.length > 0 && (
          <Panel eyebrow="Before this reaches capital" className="mt-6">
            <ul className="space-y-2.5">
              {briefing.gatingActions.map((g) => (
                <li key={g} className="flex gap-2.5 text-sm leading-relaxed text-ink-300">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lode-400" />
                  {g}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {/* --- The money --------------------------------------------------- */}
        <div className="mt-10 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <Panel eyebrow="Financial model" title="Every cost, then the tax">
            <dl className="divide-y divide-ink-800/70">
              <KeyValue k="Purchase price" v={gbp(a.costs.purchasePrice)} />
              <KeyValue k={a.costs.transferTaxLabel} v={gbp(a.costs.transferTax)} />
              <KeyValue k="Refurbishment" v={gbp(a.costs.refurbishment)} />
              <KeyValue k="Contingency" v={gbp(a.costs.contingency)} />
              <KeyValue
                k="Finance"
                v={gbp(add(a.costs.financeArrangement, a.costs.financeInterest, a.costs.financeExit, a.costs.lenderCosts))}
              />
              <KeyValue k="Legal and survey" v={gbp(add(a.costs.buyerLegal, a.costs.survey))} />
              <KeyValue k="Holding costs" v={gbp(a.costs.holdingCosts)} />
              {a.costs.sellingCosts > 0 && (
                <KeyValue k="Selling costs" v={gbp(a.costs.sellingCosts)} />
              )}
              <KeyValue k="Total deployed" v={gbp(a.costs.total)} tone="text-ink-100 font-medium" />
              <KeyValue k="Exit value" v={gbp(a.exit.grossDevelopmentValue)} />
              <KeyValue k="Profit before tax" v={gbpSigned(a.profitBeforeTax)} tone="text-ink-300" />
              <KeyValue k={a.profitTaxLabel} v={`− ${gbp(a.profitTax)}`} tone="text-ink-300" />
              <KeyValue
                k="Profit after tax"
                v={gbpSigned(a.profit)}
                tone={a.profit >= 0 ? "text-lode-200 font-medium" : "text-red-300 font-medium"}
              />
            </dl>
            <details className="mt-4 border-t hairline pt-4">
              <summary className="cursor-pointer text-xs text-ink-400 transition hover:text-ink-200">
                Tax assumptions ({a.profitTaxCaveats.length})
              </summary>
              <ul className="mt-3 space-y-2">
                {a.profitTaxCaveats.map((c) => (
                  <li key={c} className="text-xs leading-relaxed text-ink-400">
                    {c}
                  </li>
                ))}
              </ul>
            </details>
          </Panel>

          <div className="space-y-5">
            <Panel eyebrow="Returns">
              <div className="grid grid-cols-2 gap-4">
                <Metric label="Margin on GDV" value={percent(a.marginOnGdvBps)} />
                <Metric label="Return on cash" value={percent(a.roiOnCashBps, 0)} />
                <Metric label="Annualised" value={percent(a.annualisedRoiBps, 0)} />
                <Metric label="Equity required" value={gbp(a.funding.equityRequired)} />
                <Metric label="Headline discount" value={percent(a.discountToOmvBps)} />
                <Metric
                  label="True discount"
                  value={percent(a.trueDiscountBps)}
                  hint="after every cost"
                  warn={a.trueDiscountBps < 0}
                />
              </div>
            </Panel>

            <Panel eyebrow="Capital recycling">
              <p className={`tnum font-display text-4xl ${scoreTone(recycle.score)}`}>
                {percent(recycle.recycledBps, 0)}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-ink-400">{recycle.verdict}</p>
            </Panel>
          </div>
        </div>

        {/* --- Score breakdown --------------------------------------------- */}
        <Panel eyebrow="Deal Score" title="Nine components, each auditable" className="mt-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {scored.breakdown.components.map((c) => (
              <div key={c.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-ink-200">{c.label}</span>
                  <span className={`tnum text-sm ${scoreTone(c.score)}`}>{c.score}</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-800">
                  <div className={`h-full rounded-full ${scoreBg(c.score)}`} style={{ width: `${c.score}%` }} />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink-500">{c.rationale}</p>
              </div>
            ))}
          </div>
        </Panel>

        {/* --- How it fails ------------------------------------------------- */}
        <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <Panel eyebrow="AI Red Team" title="Nine ways this could break">
            <p className="mb-4 text-sm leading-relaxed text-ink-300">{scored.redTeam.summary}</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] text-sm">
                <thead>
                  <tr className="border-b hairline text-left">
                    <th className="pb-2 font-normal text-ink-500">Scenario</th>
                    <th className="pb-2 text-right font-normal text-ink-500">Profit</th>
                    <th className="pb-2 text-right font-normal text-ink-500">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-800/70">
                  {scored.redTeam.results.map((r) => (
                    <tr key={r.stress.key}>
                      <td className="py-2.5 pr-3 text-ink-300">
                        {r.stress.label}
                        {r.stress.tier === "compound" && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-ink-600">
                            compound
                          </span>
                        )}
                      </td>
                      <td className={`tnum py-2.5 text-right ${r.losesCapital ? "text-red-300" : "text-ink-100"}`}>
                        {gbpSigned(r.profit)}
                      </td>
                      <td className="tnum py-2.5 text-right text-ink-500">
                        {gbpSigned(r.profitDelta)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="space-y-5">
            <Panel eyebrow="Exit matrix" title={exits.fragile ? "Fragile" : "Ways out"}>
              <div className="space-y-2.5">
                {exits.options.map((o) => (
                  <div key={o.strategy} className="flex items-center justify-between">
                    <span className="text-sm text-ink-300">{o.label}</span>
                    <span className={`tnum text-sm ${o.viable ? "text-emerald-300" : "text-red-300"}`}>
                      {gbpSigned(o.profit)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-4 border-t hairline pt-4 text-xs leading-relaxed text-ink-400">
                {exits.summary}
              </p>
            </Panel>

            <Panel eyebrow="Seller" title="Motivation">
              <div className="grid grid-cols-2 gap-4">
                <Metric label="Motivation" value={String(diagnostics.motivation)} />
                <Metric label="Urgency" value={String(diagnostics.urgency)} />
                <Metric label="Complexity" value={String(diagnostics.complexity)} />
                <Metric label="Flexibility" value={String(diagnostics.priorityFlexibility)} />
              </div>
              <ul className="mt-4 space-y-1.5 border-t hairline pt-4">
                {diagnostics.signals.map((s) => (
                  <li key={s} className="text-xs leading-relaxed text-ink-400">
                    {s}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>

        {/* --- Structure and capital ---------------------------------------- */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Panel eyebrow="Capital stack" title={stack.feasible ? "Closes" : "Does not close"}>
            <div className="space-y-3">
              {stack.layers.map((l) => (
                <div key={l.kind} className="rounded-xl border hairline bg-ink-950/40 px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-ink-100">{l.label}</span>
                    <span className="tnum text-sm text-lode-200">{gbp(l.amount)}</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-500">{l.note}</p>
                </div>
              ))}
            </div>
            <dl className="mt-4 divide-y divide-ink-800/70 border-t hairline pt-2">
              <KeyValue k="Total requirement" v={gbp(stack.requirement)} />
              <KeyValue k="Originator cash" v={gbp(stack.originatorCash)} />
              <KeyValue
                k="Originator retains"
                v={percent(stack.originatorShareBps, 0)}
                tone="text-lode-200"
              />
            </dl>
            {stack.warnings.length > 0 && (
              <details className="mt-4 border-t hairline pt-4">
                <summary className="cursor-pointer text-xs text-amber-300/80">
                  {stack.warnings.length} warnings
                </summary>
                <ul className="mt-3 space-y-2">
                  {stack.warnings.map((w) => (
                    <li key={w} className="text-xs leading-relaxed text-ink-400">
                      {w}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Panel>

          <Panel eyebrow="Strategy Router" title={strategies.summary}>
            <div className="space-y-3">
              {[...strategies.viable, ...strategies.needsReview].slice(0, 4).map((s) => (
                <div
                  key={`${s.candidate.structure}-${s.candidate.exit}`}
                  className="rounded-xl border hairline bg-ink-950/40 px-4 py-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-ink-100">{s.candidate.label}</span>
                    <span className={`tnum text-sm ${scoreTone(s.fit)}`}>{s.fit}%</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-500">{s.reason}</p>
                </div>
              ))}
            </div>
            <details className="mt-4 border-t hairline pt-4">
              <summary className="cursor-pointer text-xs text-ink-400">
                {strategies.rejected.length} rejected
              </summary>
              <ul className="mt-3 space-y-2.5">
                {strategies.rejected.map((s) => (
                  <li key={`${s.candidate.structure}-${s.candidate.exit}`}>
                    <p className="text-xs text-ink-300">{s.candidate.label}</p>
                    <p className="text-xs leading-relaxed text-ink-500">{s.reason}</p>
                  </li>
                ))}
              </ul>
            </details>
          </Panel>
        </div>

        {/* --- Who would fund it -------------------------------------------- */}
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Panel
            eyebrow="Capital marketplace"
            title={`${funders.length} matched ${funders.length === 1 ? "mandate" : "mandates"}`}
          >
            {funders.length === 0 ? (
              <p className="text-sm text-ink-400">
                No funding mandate matches this deal. The criteria each one failed are listed below.
              </p>
            ) : (
              <div className="space-y-4">
                {funders.map((m) => (
                  <MatchRow key={m.target.id} name={m.target.funderName} match={m} />
                ))}
              </div>
            )}
            {rejectedFunders.length > 0 && (
              <details className="mt-4 border-t hairline pt-4">
                <summary className="cursor-pointer text-xs text-ink-400">
                  {rejectedFunders.length} did not match
                </summary>
                <div className="mt-3 space-y-3">
                  {rejectedFunders.map((m) => (
                    <div key={m.target.id}>
                      <p className="text-xs text-ink-300">{m.target.funderName}</p>
                      <ul className="mt-1 space-y-1">
                        {m.blockers.map((b) => (
                          <li key={b} className="text-xs leading-relaxed text-ink-500">
                            {b}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </Panel>

          <Panel
            eyebrow="Buyer demand"
            title={`${buyers.length} matched ${buyers.length === 1 ? "Buy Box" : "Buy Boxes"}`}
          >
            {buyers.length === 0 ? (
              <p className="text-sm text-ink-400">
                No investor mandate matches this deal on every hard criterion.
              </p>
            ) : (
              <div className="space-y-4">
                {buyers.map((m) => (
                  <MatchRow key={m.target.id} name={m.target.investorName} match={m} />
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* --- Execution ----------------------------------------------------- */}
        {close !== undefined && (
          <Panel eyebrow="Close" title={close.summary} className="mt-5">
            <div className="grid gap-8 lg:grid-cols-2">
              <div>
                <div className="flex items-baseline gap-8">
                  <div>
                    <p className={`tnum font-display text-4xl ${scoreTone(close.closeScore)}`}>
                      {close.closeScore}%
                    </p>
                    <p className="text-[10px] uppercase tracking-[0.1em] text-ink-500">Close score</p>
                  </div>
                  <div>
                    <p className={`tnum font-display text-4xl ${scoreTone(close.completionProbability)}`}>
                      {close.completionProbability}%
                    </p>
                    <p className="text-[10px] uppercase tracking-[0.1em] text-ink-500">
                      Completion probability
                    </p>
                  </div>
                </div>
                <div className="mt-6 space-y-2.5">
                  {close.sections.map((s) => (
                    <div key={s.label}>
                      <div className="flex justify-between text-xs">
                        <span className="text-ink-400">{s.label}</span>
                        <span className="tnum text-ink-300">{s.percent}%</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-800">
                        <div className={`h-full rounded-full ${scoreBg(s.percent)}`} style={{ width: `${s.percent}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-500">
                  Blockers, ranked by what they hold up
                </p>
                <div className="mt-3 space-y-3">
                  {close.blockers.slice(0, 5).map((b) => (
                    <div
                      key={b.milestone.key}
                      className={`rounded-xl border px-4 py-3 ${b.severity === "red" ? "border-red-500/30 bg-red-500/5" : "border-amber-500/25 bg-amber-500/5"}`}
                    >
                      <p className="text-sm text-ink-100">{b.message}</p>
                      <p className="mt-1 text-xs leading-relaxed text-ink-400">{b.action}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-ink-400">
                  Critical path remaining:{" "}
                  <span className="tnum text-ink-200">{close.criticalPathDays} days</span>
                </p>
              </div>
            </div>
          </Panel>
        )}

        <TradeReferrals
          report={referTradePartners(record.property, record.seller)}
          heading="Who does the works"
          intro="The refurbishment line above is an assumption until somebody prices it. These are the contractors we would put on it, and the estimate is what the appraisal should be re-run against."
        />

        {/* --- Platform economics -------------------------------------------- */}
        <Panel eyebrow="Platform revenue" title="If this completes" className="mt-5">
          <dl className="divide-y divide-ink-800/70">
            {revenue.lines.map((l) => (
              <KeyValue
                key={l.stream}
                k={l.included ? l.label : `${l.label} — ${l.excludedBecause}`}
                v={gbp(l.amount)}
                tone={l.included ? undefined : "text-ink-600"}
              />
            ))}
            <KeyValue k="Total" v={gbp(revenue.total)} tone="text-lode-200 font-medium" />
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-ink-500">{revenue.note}</p>
        </Panel>

        <footer className="mt-10 border-t hairline pt-8">
          <p className="text-xs leading-relaxed text-ink-500">
            Figures are engine estimates for screening only and are not advice. Tax estimates require
            confirmation by a qualified adviser before exchange. Operating in this jurisdiction
            engages {briefing.obligations.length} regulatory obligations. Rate tables are dated
            snapshots and must be re-verified each Budget.
          </p>
        </footer>
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.1em] text-ink-500">{label}</p>
      <p className={`tnum mt-1 text-2xl ${warn === true ? "text-red-300" : "text-ink-100"}`}>{value}</p>
      {hint !== undefined && <p className="text-[10px] text-ink-500">{hint}</p>}
    </div>
  );
}

/**
 * A match with its reasoning attached. The met/missed split is the point:
 * a percentage with nothing behind it is not something a lender can
 * underwrite against.
 */
function MatchRow<T>({ name, match }: { name: string; match: MatchResult<T> }) {
  const missed = match.criteria.filter((c) => !c.met);
  return (
    <div className="rounded-xl border hairline bg-ink-950/40 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-ink-100">{name}</span>
        <span className={`tnum text-sm ${scoreTone(match.score)}`}>{match.score}% match</span>
      </div>
      {missed.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-ink-500">
            Meets {match.criteria.length - missed.length} of {match.criteria.length} criteria
          </summary>
          <ul className="mt-2 space-y-1">
            {missed.map((c) => (
              <li key={c.label} className="text-xs leading-relaxed text-ink-500">
                {c.label}: {c.detail}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

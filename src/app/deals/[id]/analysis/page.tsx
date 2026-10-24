import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/app/components/chrome";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { audit } from "@backend/audit";
import { meter } from "@backend/billing/meter";
import { getDeal } from "@backend/store/repository";
import { runDealDirector } from "@shared/domain/director";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { operationPrice } from "@shared/domain/pricing";
import { gbp, gbpSigned, percent } from "@shared/format";
import { runAgent, type AgentOutcome } from "@backend/agent/runtime";
import { dealAgentTools } from "@backend/agent/dataTools";
import { describeProvenance } from "@backend/agent/provenance";

export const dynamic = "force-dynamic";

export const metadata = { title: "AI analysis — Lode" };

/**
 * Live AI deal analysis.
 *
 * A Claude agent runs over the deal and the live sources, orchestrating the work
 * and writing the assessment — but it may not state a figure a tool did not
 * return. Every number here is therefore the engine's (computed) or a real
 * record's (EPC, Price Paid), each printed with where it came from. The model
 * writes the words; it does not decide a figure.
 *
 * The engine's figures are shown free, always — the same numbers as the Deal
 * Room. The live AI run is explicit (`?run=1`) and metered once per period, so a
 * passive view never spends a credit or calls the model, and a plain refresh of
 * a completed run is free. With no model key, or on any failure, the page falls
 * back to the engine's figures rather than breaking: a model outage costs the
 * narrative, never the analysis.
 */

const TASK =
  "Analyse this property deal for an investment committee. First call appraise_deal for the engine's figures, then epc_lookup for the real floor area and condition, then sold_comparables for registered market evidence. Then write a committee-ready assessment in two or three short paragraphs: the recommendation, the economics, what the market evidence shows, and the single most important risk or condition. Never state a figure a tool did not return to you.";

export default async function AnalysisPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const viewer = await requirePermission("view-deal-material", `/deals/${id}/analysis`);
  const record = await getDeal(id);
  if (record === undefined) notFound();

  const query = await searchParams;
  const run = (Array.isArray(query.run) ? query.run[0] : query.run) === "1";

  const inputs = toWorkingDeal(record.inputs).inputs;
  const briefing = runDealDirector(inputs);
  const a = briefing.scored.appraisal;

  // The engine's figures, always shown and free — the deterministic baseline the
  // live run narrates over. These are the numbers the agent's appraise_deal tool
  // returns; printing them here means the page says something true even before
  // the model is called.
  const baseline: readonly { label: string; value: string }[] = [
    { label: "Deal Score", value: `${briefing.scored.breakdown.composite}/100` },
    { label: "Verdict", value: briefing.verdict },
    { label: "Margin on GDV", value: percent(a.marginOnGdvBps, 1) },
    { label: "True discount to value", value: percent(a.trueDiscountBps, 1) },
    { label: "Profit after tax", value: gbpSigned(a.profit) },
    { label: "Highest viable price", value: gbp(briefing.maxViablePrice) },
  ];

  const price = gbp(operationPrice("ai-deal-analysis"));

  let outcome: AgentOutcome | undefined;
  let failure: string | undefined;

  if (run) {
    const charge = await meter(viewerAccount(viewer), "ai-deal-analysis", record.id);
    if (!charge.allowed) {
      await audit("access-denied", {
        ...(viewerAccount(viewer) !== undefined ? { account: viewerAccount(viewer) } : {}),
        subject: record.id,
        detail: charge.reason,
      });
      return <OutOfAllowance reason={charge.reason} dealId={record.id} />;
    }
    await audit("viewed-deal-material", {
      ...(viewerAccount(viewer) !== undefined ? { account: viewerAccount(viewer) } : {}),
      subject: record.id,
      detail: `${record.reference} (ai-deal-analysis, ${charge.outcome})`,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      outcome = await runAgent({
        task: `${TASK}\n\nThe deal reference is ${record.reference}.`,
        tools: dealAgentTools(inputs),
        maxSteps: 8,
        signal: controller.signal,
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }
  }

  const paragraphs =
    outcome !== undefined
      ? outcome.text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p !== "")
      : [];

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href={`/deals/${record.id}`} className="transition hover:text-ink-100">Deal Room</Link>
            <Link href={`/deals/${record.id}/memorandum`} className="transition hover:text-ink-100">Memorandum</Link>
          </nav>
        }
      />

      <div className="mx-auto max-w-3xl px-6 py-10">
        <span className="eyebrow">AI analysis · {record.reference}</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {record.property.locality}, {record.property.postcodeArea}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          A live agent reads the engine, the EPC register and HM Land Registry sold prices, then
          writes the assessment. It orchestrates the work and the words; it never states a figure a
          tool did not return — every number below is the engine&rsquo;s or a real record&rsquo;s,
          with its source shown.
        </p>

        <section className="mt-8 rounded-2xl border hairline bg-surface-1 px-5 py-4">
          <h2 className="eyebrow">The engine&rsquo;s figures</h2>
          <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
            {baseline.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-4">
                <dt className="text-sm text-ink-400">{row.label}</dt>
                <dd className="font-mono text-sm text-ink-100 tnum">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-ink-500">Computed after tax by the Lode engine. Shown free; the same figures as the Deal Room.</p>
        </section>

        {!run && (
          <section className="mt-6 rounded-2xl border hairline bg-surface-1 px-5 py-5">
            <h2 className="font-display text-base text-ink-100">Run a live AI analysis</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-400">
              A Claude agent reads the live sources and writes a committee-ready assessment over the
              figures above. It costs {price} (one metered analysis), charged once per period — a
              repeat view in the same period is free.
            </p>
            <Link
              href={`/deals/${record.id}/analysis?run=1`}
              className="mt-4 inline-flex h-10 items-center rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-100 transition-colors hover:border-ink-600 hover:bg-surface-3"
            >
              Run live analysis · {price}
            </Link>
          </section>
        )}

        {run && failure !== undefined && (
          <section className="mt-6 border-l-2 border-amber-400/70 py-1 pl-4 text-[13px] leading-[1.65] text-ink-300">
            Live AI analysis is unavailable right now ({failure}). The engine&rsquo;s figures above
            stand on their own — nothing here depends on the model being reachable.
          </section>
        )}

        {run && outcome !== undefined && (
          <>
            <section className="mt-6 rounded-2xl border hairline bg-surface-1 px-5 py-4">
              <h2 className="eyebrow">Assessment</h2>
              {paragraphs.length > 0 ? (
                paragraphs.map((para, i) => (
                  <p key={i} className="mt-3 text-sm leading-relaxed text-ink-200">{para}</p>
                ))
              ) : (
                <p className="mt-3 text-sm text-ink-400">
                  The agent did not return a written assessment. The sourced figures below, and the
                  engine&rsquo;s figures above, stand on their own.
                </p>
              )}
            </section>

            {Object.keys(outcome.data).length > 0 && (
              <section className="mt-6 rounded-2xl border hairline bg-surface-1 px-5 py-4">
                <h2 className="eyebrow">Sourced figures</h2>
                <ul className="mt-4 space-y-2.5">
                  {Object.entries(outcome.data).map(([key, sourced]) => (
                    <li key={key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                      <span className="text-sm text-ink-300">{humanise(key)}</span>
                      <span className="font-mono text-sm text-ink-100 tnum">
                        {String(sourced.value)}
                        <span className="ml-2 text-[11px] text-ink-500">{describeProvenance(sourced.provenance)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-ink-500">
                  Every figure is the engine&rsquo;s or a named source&rsquo;s. The model wrote the
                  assessment; it did not produce any of these numbers.
                </p>
              </section>
            )}

            {outcome.steps.length > 0 && (
              <section className="mt-6 rounded-2xl border hairline bg-surface-1 px-5 py-4">
                <h2 className="eyebrow">What it checked</h2>
                <ul className="mt-4 space-y-2">
                  {outcome.steps.map((step, i) => (
                    <li key={i} className="text-sm leading-relaxed">
                      <span className={`font-mono text-xs ${step.ok ? "text-emerald-300" : "text-amber-300"}`}>
                        {step.ok ? "RAN" : "SKIP"}
                      </span>{" "}
                      <span className="text-ink-200">{step.tool}</span>
                      <span className="text-ink-600"> — </span>
                      <span className="text-ink-400">{step.summary}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!outcome.complete && (
              <p className="mt-4 text-xs text-ink-500">
                The agent reached its step limit before finishing. What it established is above;
                run it again for a fuller pass.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}

/** camelCase or kebab key to words: "marginOnGdv" → "Margin on gdv". */
function humanise(key: string): string {
  const spaced = key.replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function OutOfAllowance({ reason, dealId }: { reason: string; dealId: string }) {
  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <Link href={`/deals/${dealId}`} className="text-sm text-ink-400 transition hover:text-ink-100">
            Deal Room
          </Link>
        }
      />
      <div className="mx-auto max-w-2xl px-6 py-16">
        <span className="eyebrow">AI analysis</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100">Not available on this plan right now</h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-300">{reason}</p>
        <Link
          href="/account/billing"
          className="mt-6 inline-flex h-10 items-center rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-100 transition-colors hover:border-ink-600 hover:bg-surface-3"
        >
          Top up or change plan
        </Link>
      </div>
    </main>
  );
}

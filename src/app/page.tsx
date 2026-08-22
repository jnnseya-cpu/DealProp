import Link from "next/link";
import { runDealDirector } from "@shared/domain/director";
import { dealRevenue } from "@shared/domain/revenue";
import { HEAT_LABELS, scoreGoldMine } from "@shared/domain/goldmine";
import { buildCloseReport } from "@shared/domain/completion";
import { countInterestedBuyers, matchFundingBox, rankMatches } from "@shared/domain/matching";
import { SEED_BUY_BOXES, SEED_DEALS, SEED_FUNDING_BOXES } from "@backend/store/seed";
import { add, sub, type Money } from "@shared/money";
import { gbp, gbpSigned, percent } from "@shared/format";
import { Mark, scoreBg, scoreTone, VERDICT_TONE } from "@/app/components/chrome";
import { BUYER_TIERS } from "@shared/domain/revenue";

/**
 * Landing page.
 *
 * Every figure on this page is computed by the engine at render time from the
 * seeded Erdington deal. Nothing is hardcoded copy dressed as a number — if
 * the appraisal changes, the marketing changes, which is the only honest way
 * to show a product whose whole claim is that its numbers are trustworthy.
 */

export default function Home() {
  const record = SEED_DEALS[0];
  if (record === undefined) throw new Error("seed deal missing");

  const briefing = runDealDirector(record.inputs);
  const { scored, stack, exits, recycle, strategies } = briefing;
  const buyers = countInterestedBuyers(SEED_BUY_BOXES, scored);
  const funders = rankMatches(
    SEED_FUNDING_BOXES.map((b) => matchFundingBox(b, scored, record.borrowerCompletedDeals)),
  );
  const close = buildCloseReport(record.milestones ?? []);
  const revenue = dealRevenue(scored.appraisal);
  const goldmine = record.listing !== undefined ? scoreGoldMine(record.listing, record.property) : undefined;

  const stress = (key: string): Money =>
    scored.redTeam.results.find((r) => r.stress.key === key)?.profit ?? scored.appraisal.profit;

  return (
    <main className="relative overflow-x-hidden">
      <Nav />
      <Hero
        score={scored.breakdown.composite}
        verdict={briefing.verdict}
        headline={briefing.headline}
        buyers={buyers}
        funders={funders.length}
      />
      <Doors />
      <LiveDeal
        briefing={briefing}
        buyers={buyers}
        funderCount={funders.length}
        topFunder={funders[0]?.target.funderName}
      />
      <ScoreSection components={scored.breakdown.components} composite={scored.breakdown.composite} />
      <RedTeamSection
        base={scored.appraisal.profit}
        moderate={stress("moderate")}
        severe={stress("severe")}
        capitalLoss={stress("capital-loss")}
        resilience={scored.redTeam.resilience}
        summary={scored.redTeam.summary}
      />
      <StackSection stack={stack} />
      <StrategySection strategies={strategies} exits={exits} recycle={recycle} />
      {goldmine !== undefined && <GoldMineSection goldmine={goldmine} listing={record.listing!} />}
      <CloseSection close={close} />
      <ProtectionSection protection={scored.protection} />
      <RevenueSection revenue={revenue} />
      <Pricing />
      <Footer />
    </main>
  );
}

// ---------------------------------------------------------------------------

function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b hairline bg-ink-950/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <Mark />
          <span className="font-display text-xl tracking-tight text-ink-100">Lode</span>
          <span className="ml-2 hidden rounded-full border hairline px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-ink-400 sm:block">
            Property Deal OS
          </span>
        </div>
        <div className="hidden items-center gap-8 text-sm text-ink-300 lg:flex">
          <Link href="/deals" className="transition hover:text-ink-100">Deals</Link>
          <Link href="/sell" className="transition hover:text-ink-100">Sell</Link>
          <a href="#engine" className="transition hover:text-ink-100">Deal Engine</a>
          <a href="#stack" className="transition hover:text-ink-100">Capital</a>
          <a href="#goldmine" className="transition hover:text-ink-100">GoldMine</a>
          <a href="#close" className="transition hover:text-ink-100">Close</a>
          <a href="#pricing" className="transition hover:text-ink-100">Pricing</a>
        </div>
        <div className="flex items-center gap-3">
          <button className="hidden text-sm text-ink-300 transition hover:text-ink-100 sm:block">Sign in</button>
          <Link
            href="/sell"
            className="rounded-full bg-lode-400 px-4 py-2 text-sm font-medium text-ink-950 transition hover:bg-lode-300"
          >
            Get deal options
          </Link>
        </div>
      </div>
    </nav>
  );
}


function Hero({
  score,
  verdict,
  headline,
  buyers,
  funders,
}: {
  score: number;
  verdict: string;
  headline: string;
  buyers: { total: number; fast: number };
  funders: number;
}) {
  return (
    <section className="grain relative border-b hairline">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 55% at 18% 0%, rgba(212,169,75,0.13), transparent 62%), radial-gradient(50% 45% at 92% 22%, rgba(212,169,75,0.07), transparent 70%)",
        }}
      />
      <div className="relative mx-auto grid max-w-7xl gap-16 px-6 py-24 lg:grid-cols-[1.05fr_0.95fr] lg:py-32">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border hairline bg-ink-900/60 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-lode-300">
            <span className="h-1.5 w-1.5 rounded-full bg-lode-400" />
            For motivated sellers only
          </div>

          <h1 className="mt-7 font-display text-5xl leading-[1.05] tracking-tight text-ink-100 sm:text-6xl lg:text-7xl">
            Don&apos;t list your
            <br />
            property.
            <br />
            <span className="text-lode-300">Solve</span> your
            <br />
            property problem.
          </h1>

          <p className="mt-8 max-w-xl text-lg leading-relaxed text-ink-300">
            Lode is not a portal. It is a deal engine. Sellers bring a situation, dealmakers bring
            the opportunity, funders bring the capital — and the OS structures a transaction that
            survives tax, stress testing and completion.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/sell"
              className="rounded-full bg-lode-400 px-6 py-3 text-sm font-medium text-ink-950 transition hover:bg-lode-300"
            >
              Get my deal options
            </Link>
            <Link
              href="/deals"
              className="rounded-full border hairline px-6 py-3 text-sm text-ink-200 transition hover:border-ink-400 hover:text-ink-100"
            >
              Browse the pipeline
            </Link>
          </div>

          <dl className="mt-14 grid max-w-lg grid-cols-3 gap-6 border-t hairline pt-8">
            <Stat label="Verified buyers" value={String(buyers.total)} sub={`${buyers.fast} can complete ≤28 days`} />
            <Stat label="Capital mandates" value={String(funders)} sub="matched to this deal" />
            <Stat label="Strategies tested" value="14" sub="per property, before advice" />
          </dl>
        </div>

        <div className="lg:pt-6">
          <VerdictCard score={score} verdict={verdict} headline={headline} />
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-400">{label}</dt>
      <dd className="tnum mt-1.5 font-display text-3xl text-ink-100">{value}</dd>
      <dd className="mt-1 text-xs leading-snug text-ink-400">{sub}</dd>
    </div>
  );
}


function VerdictCard({ score, verdict, headline }: { score: number; verdict: string; headline: string }) {
  const v = VERDICT_TONE[verdict as keyof typeof VERDICT_TONE] ?? VERDICT_TONE.negotiate;
  return (
    <div className="overflow-hidden rounded-2xl border hairline bg-ink-900/70 shadow-2xl shadow-black/40 backdrop-blur">
      <div className="flex items-center justify-between border-b hairline px-6 py-4">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-lode-400" />
          <span className="font-mono text-xs tracking-wider text-ink-300">LODE-0001 · ERDINGTON B23</span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">Live appraisal</span>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-6 px-6 py-7">
        <ScoreDial score={score} />
        <div>
          <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${v.chip}`}>
            AI Deal Director: {v.label}
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink-300">{headline}</p>
        </div>
      </div>

      <div className="border-t hairline px-6 py-5">
        <p className="text-[11px] uppercase tracking-[0.12em] text-ink-400">Why this deal exists</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-200">
          Probate. Empty 412 days, three agents, two relistings. The family live 200 miles away and
          want it dealt with — not maximised.
        </p>
      </div>
    </div>
  );
}

function ScoreDial({ score }: { score: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const filled = (score / 100) * c;
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-ink-700)" strokeWidth="7" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="var(--color-lode-400)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tnum font-display text-3xl text-ink-100">{score}</span>
        <span className="text-[9px] uppercase tracking-[0.14em] text-ink-400">Deal score</span>
      </div>
    </div>
  );
}

function Doors() {
  const doors = [
    {
      tag: "Sell",
      title: "I have a property problem",
      body: "Tell us the situation, not the asking price. The OS returns the routes that actually solve it — cash, deferred, JV or assisted sale.",
      cta: "Get solutions",
    },
    {
      tag: "Buy",
      title: "I want property deals",
      body: "Set a Buy Box once. Every qualified deal is matched, appraised after tax and stress-tested before it reaches you.",
      cta: "Create Buy Box",
    },
    {
      tag: "Fund",
      title: "I have capital",
      body: "Set a Funding Box. Receive deals inside your mandate with the underwriting already done and the downside already modelled.",
      cta: "Create Funding Box",
    },
  ];

  return (
    <section className="border-b hairline bg-ink-900/30">
      <div className="mx-auto grid max-w-7xl gap-px overflow-hidden md:grid-cols-3">
        {doors.map((d) => (
          <div key={d.tag} className="group relative border-r hairline px-8 py-12 transition hover:bg-ink-900/60 last:border-r-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">{d.tag}</span>
            <h3 className="mt-4 font-display text-2xl leading-snug text-ink-100">{d.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-ink-400">{d.body}</p>
            <span className="mt-6 inline-flex items-center gap-1.5 text-sm text-lode-300 transition group-hover:gap-2.5">
              {d.cta}
              <span aria-hidden>→</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function LiveDeal({
  briefing,
  buyers,
  funderCount,
  topFunder,
}: {
  briefing: ReturnType<typeof runDealDirector>;
  buyers: { total: number; fast: number };
  funderCount: number;
  topFunder?: string;
}) {
  const a = briefing.scored.appraisal;
  // The figure a naive appraisal would quote: finished value less price and
  // works, ignoring tax, finance and everything else. Shown so the gap against
  // the real number is the reader's own arithmetic, not a claim.
  const naiveProfit = sub(a.exit.grossDevelopmentValue, add(a.costs.purchasePrice, a.costs.refurbishment));
  const rows: [string, string][] = [
    ["Purchase price", gbp(a.costs.purchasePrice)],
    [a.costs.transferTaxLabel, gbp(a.costs.transferTax)],
    ["Refurbishment", gbp(a.costs.refurbishment)],
    ["Contingency", gbp(a.costs.contingency)],
    [
      "Finance (fees + interest)",
      gbp(add(a.costs.financeArrangement, a.costs.financeInterest, a.costs.financeExit, a.costs.lenderCosts)),
    ],
    ["Legal, survey, holding", gbp(add(a.costs.buyerLegal, a.costs.survey, a.costs.holdingCosts))],
  ];

  return (
    <section id="engine" className="border-b hairline">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <SectionHead
          eyebrow="Deal Engine"
          title="The number most sourcers never show you"
          lede={`A property bought at ${gbp(a.costs.purchasePrice)} and worth ${gbp(a.exit.grossDevelopmentValue)} finished is not a ${gbp(naiveProfit)} profit. Lode charges every cost, then charges the tax, and only then scores the deal.`}
        />

        <div className="mt-14 grid items-start gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border hairline bg-ink-900/50">
            <div className="border-b hairline px-6 py-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">True cost of the transaction</span>
            </div>
            <dl className="divide-y divide-ink-800/80">
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-6 py-3.5">
                  <dt className="text-sm text-ink-300">{k}</dt>
                  <dd className="tnum text-sm text-ink-100">{v}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between bg-ink-850/60 px-6 py-4">
                <dt className="text-sm font-medium text-ink-200">Total deployed</dt>
                <dd className="tnum text-base font-medium text-ink-100">{gbp(a.costs.total)}</dd>
              </div>
            </dl>
          </div>

          <div className="space-y-4">
            <BigFigure
              label="Profit before tax"
              value={gbpSigned(a.profitBeforeTax)}
              muted
            />
            <BigFigure
              label={a.profitTaxLabel}
              value={`− ${gbp(a.profitTax)}`}
              muted
            />
            <BigFigure
              label="Profit after tax"
              value={gbpSigned(a.profit)}
              accent
            />
            <div className="grid grid-cols-2 gap-4">
              <MiniStat label="Headline discount" value={percent(a.discountToOmvBps)} />
              <MiniStat label="True discount" value={percent(a.trueDiscountBps)} hint="after every cost" />
              <MiniStat label="Margin on GDV" value={percent(a.marginOnGdvBps)} />
              <MiniStat label="Return on cash" value={percent(a.roiOnCashBps, 0)} />
            </div>
            <div className="rounded-xl border hairline bg-ink-900/50 px-5 py-4">
              <p className="text-sm text-ink-300">
                <span className="text-lode-300">
                  {buyers.total} verified {buyers.total === 1 ? "buyer" : "buyers"}
                </span>{" "}
                and{" "}
                <span className="text-lode-300">
                  {funderCount} capital {funderCount === 1 ? "mandate" : "mandates"}
                </span>{" "}
                match this deal{topFunder !== undefined && <> — strongest is {topFunder}</>}.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function BigFigure({ label, value, accent, muted }: { label: string; value: string; accent?: boolean; muted?: boolean }) {
  return (
    <div className={`rounded-xl border px-5 py-4 ${accent ? "border-lode-500/40 bg-lode-400/10" : "hairline bg-ink-900/50"}`}>
      <p className="text-[11px] uppercase tracking-[0.12em] text-ink-400">{label}</p>
      <p className={`tnum mt-1 font-display text-3xl ${accent ? "text-lode-200" : muted ? "text-ink-300" : "text-ink-100"}`}>
        {value}
      </p>
    </div>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border hairline bg-ink-900/40 px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.12em] text-ink-400">{label}</p>
      <p className="tnum mt-1 text-xl text-ink-100">{value}</p>
      {hint !== undefined && <p className="mt-0.5 text-[10px] text-ink-400">{hint}</p>}
    </div>
  );
}

function SectionHead({ eyebrow, title, lede }: { eyebrow: string; title: string; lede: string }) {
  return (
    <div className="max-w-3xl">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">{eyebrow}</span>
      <h2 className="mt-4 font-display text-4xl leading-tight tracking-tight text-ink-100 sm:text-5xl">{title}</h2>
      <p className="mt-5 text-lg leading-relaxed text-ink-400">{lede}</p>
    </div>
  );
}

function ScoreSection({
  components,
  composite,
}: {
  components: readonly { key: string; label: string; score: number; rationale: string }[];
  composite: number;
}) {
  return (
    <section className="border-b hairline bg-ink-900/30">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="grid gap-14 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <SectionHead
              eyebrow="Deal Score"
              title="Nine components. Every one auditable."
              lede="A score a lender cannot interrogate is worth nothing to them. Each component carries the reasoning that produced it."
            />
            <div className="mt-10 flex items-baseline gap-3">
              <span className={`tnum font-display text-7xl ${scoreTone(composite)}`}>{composite}</span>
              <span className="text-2xl text-ink-500">/100</span>
            </div>
          </div>

          <div className="space-y-3">
            {components.map((c) => (
              <div key={c.key} className="rounded-xl border hairline bg-ink-900/50 px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium text-ink-200">{c.label}</span>
                  <span className={`tnum text-sm ${scoreTone(c.score)}`}>{c.score}</span>
                </div>
                <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-ink-800">
                  <div className={`h-full rounded-full ${scoreBg(c.score)}`} style={{ width: `${c.score}%` }} />
                </div>
                <p className="mt-2.5 text-xs leading-relaxed text-ink-400">{c.rationale}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function RedTeamSection({
  base,
  moderate,
  severe,
  capitalLoss,
  resilience,
  summary,
}: {
  base: Money;
  moderate: Money;
  severe: Money;
  capitalLoss: Money;
  resilience: number;
  summary: string;
}) {
  const scenarios: { label: string; value: Money; note: string }[] = [
    { label: "Base case", value: base, note: "As appraised, after tax" },
    { label: "Moderate downside", value: moderate, note: "Value −5%, works +15%, 2 months late" },
    { label: "Severe downside", value: severe, note: "Value −12%, works +30%, 6 months late, rates +2%" },
    { label: "Capital loss scenario", value: capitalLoss, note: "Value −20%, works +50%, 12 months late, rates +4%" },
  ];

  return (
    <section className="border-b hairline">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <SectionHead
          eyebrow="AI Red Team"
          title="An independent agent tries to destroy the deal"
          lede="Before any pack reaches a funder, nine fixed stress scenarios run against it. Lenders see the downside at the same moment they see the headline — and every deal on Lode is shocked identically, so they compare."
        />

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {scenarios.map((s) => (
            <div
              key={s.label}
              className={`rounded-xl border px-5 py-6 ${s.value < 0 ? "border-red-500/40 bg-red-500/5" : "hairline bg-ink-900/50"}`}
            >
              <p className="text-[11px] uppercase tracking-[0.12em] text-ink-400">{s.label}</p>
              <p className={`tnum mt-2 font-display text-3xl ${s.value < 0 ? "text-red-300" : "text-ink-100"}`}>
                {gbpSigned(s.value)}
              </p>
              <p className="mt-2.5 text-xs leading-snug text-ink-400">{s.note}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-6 rounded-xl border hairline bg-ink-900/40 px-6 py-5">
          <div>
            <p className="text-[11px] uppercase tracking-[0.12em] text-ink-400">Resilience</p>
            <p className={`tnum font-display text-3xl ${scoreTone(resilience)}`}>{resilience}/100</p>
          </div>
          <p className="max-w-2xl flex-1 text-sm leading-relaxed text-ink-300">{summary}</p>
        </div>
      </div>
    </section>
  );
}

function StackSection({ stack }: { stack: ReturnType<typeof runDealDirector>["stack"] }) {
  return (
    <section id="stack" className="border-b hairline bg-ink-900/30">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <SectionHead
          eyebrow="Capital Stack"
          title="Bring the deal. Not necessarily the deposit."
          lede="The capital does not disappear — someone provides every pound and prices it. Lode assembles that stack around a viable transaction and states plainly what the originator is really contributing."
        />

        <div className="mt-14 grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-3">
            {stack.layers.map((l) => (
              <div key={l.kind} className="rounded-xl border hairline bg-ink-900/50 px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-ink-100">{l.label}</span>
                  <span className="tnum font-display text-2xl text-lode-200">{gbp(l.amount)}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink-400">{l.note}</p>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-xl border border-lode-500/30 bg-lode-400/5 px-5 py-4">
              <span className="text-sm text-ink-200">Originator cash required</span>
              <span className="tnum font-display text-2xl text-lode-200">{gbp(stack.originatorCash)}</span>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border hairline bg-ink-900/50 px-5 py-5">
              <p className="text-[11px] uppercase tracking-[0.12em] text-ink-400">Originator retains</p>
              <p className="tnum mt-1 font-display text-4xl text-ink-100">{percent(stack.originatorShareBps, 0)}</p>
              <p className="mt-2 text-xs text-ink-400">of residual profit, for sourcing, negotiation and execution</p>
            </div>
            {stack.warnings.slice(0, 3).map((w) => (
              <div key={w} className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-5 py-4">
                <p className="text-xs leading-relaxed text-amber-200/90">{w}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function StrategySection({
  strategies,
  exits,
  recycle,
}: {
  strategies: ReturnType<typeof runDealDirector>["strategies"];
  exits: ReturnType<typeof runDealDirector>["exits"];
  recycle: ReturnType<typeof runDealDirector>["recycle"];
}) {
  return (
    <section className="border-b hairline">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <SectionHead
          eyebrow="Strategy Router"
          title="One property. Fourteen strategies tested. Most rejected."
          lede="Never force a property into a predetermined strategy. The rejections are the product — an investor who is told why cash purchase fails but assisted sale clears has learned something reusable."
        />

        <div className="mt-14 grid gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="mb-4 flex flex-wrap gap-3 text-xs">
              <Chip tone="emerald">{strategies.viable.length} viable</Chip>
              <Chip tone="amber">{strategies.needsReview.length} need professional review</Chip>
              <Chip tone="red">{strategies.rejected.length} rejected</Chip>
            </div>
            <div className="space-y-3">
              {[...strategies.viable, ...strategies.needsReview].slice(0, 5).map((s) => (
                <div key={`${s.candidate.structure}-${s.candidate.exit}`} className="rounded-xl border hairline bg-ink-900/50 px-5 py-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm font-medium text-ink-100">{s.candidate.label}</span>
                    <span className={`tnum text-sm ${scoreTone(s.fit)}`}>{s.fit}% fit</span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-ink-400">{s.reason}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border hairline bg-ink-900/50 p-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">Exit matrix</p>
              <div className="mt-4 space-y-2.5">
                {exits.options.map((o) => (
                  <div key={o.strategy} className="flex items-center justify-between">
                    <span className="text-sm text-ink-300">{o.label}</span>
                    <span className={`tnum text-sm ${o.viable ? "text-emerald-300" : "text-red-300"}`}>
                      {gbpSigned(o.profit)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-4 border-t hairline pt-4 text-xs leading-relaxed text-ink-400">{exits.summary}</p>
            </div>

            <div className="rounded-2xl border hairline bg-ink-900/50 p-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">Capital recycling</p>
              <p className="tnum mt-3 font-display text-4xl text-ink-100">{percent(recycle.recycledBps, 0)}</p>
              <p className="mt-2 text-xs leading-relaxed text-ink-400">{recycle.verdict}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone: "emerald" | "amber" | "red" }) {
  const tones = {
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    red: "border-red-500/30 bg-red-500/10 text-red-300",
  };
  return <span className={`rounded-full border px-3 py-1 ${tones[tone]}`}>{children}</span>;
}

function GoldMineSection({
  goldmine,
  listing,
}: {
  goldmine: ReturnType<typeof scoreGoldMine>;
  listing: { daysOnMarket: number; priceReductions: number; agentCount: number; relistCount: number };
}) {
  return (
    <section id="goldmine" className="border-b hairline bg-ink-900/30">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <SectionHead
          eyebrow="AI Property GoldMine"
          title="Why has this property not sold?"
          lede="Time on market alone is weak evidence. A year at an unchanged price means a stubborn seller. A year of repeated reductions and relistings means someone actively trying and failing — a real problem the platform can solve."
        />

        <div className="mt-14 grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-2xl border hairline bg-ink-900/50 p-7">
            <div className="flex items-center justify-between">
              <span className="rounded-full border border-lode-500/40 bg-lode-400/10 px-3 py-1 text-xs text-lode-200">
                {HEAT_LABELS[goldmine.heat]}
              </span>
              <span className="tnum font-display text-4xl text-lode-200">{goldmine.score}</span>
            </div>
            <dl className="mt-6 space-y-3 border-t hairline pt-5 text-sm">
              <Row k="Days on market" v={String(listing.daysOnMarket)} />
              <Row k="Price reductions" v={String(listing.priceReductions)} />
              <Row k="Agents used" v={String(listing.agentCount)} />
              <Row k="Relistings" v={String(listing.relistCount)} />
              <Row k="Seller pressure" v={`${goldmine.pressure.score}/100`} />
            </dl>
            <div className="mt-6 border-t hairline pt-5">
              <p className="text-[11px] uppercase tracking-[0.12em] text-ink-400">Suggested approach</p>
              <p className="tnum mt-2 text-lg text-ink-100">
                Open {gbp(goldmine.openingOffer)} · Zone {gbp(goldmine.negotiationFloor)}–{gbp(goldmine.negotiationCeiling)}
              </p>
            </div>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">Diagnosis</p>
            <div className="mt-4 space-y-4">
              {goldmine.reasons.map((r) => (
                <div key={r.cause}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm text-ink-200">{r.cause}</span>
                    <span className="tnum text-sm text-lode-300">{r.weight}%</span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-800">
                    <div className="h-full rounded-full bg-lode-400" style={{ width: `${r.weight}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-400">{r.detail}</p>
                </div>
              ))}
            </div>
            <p className="mt-7 rounded-xl border hairline bg-ink-900/50 px-5 py-4 text-sm leading-relaxed text-ink-300">
              {goldmine.recommendation}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-400">{k}</dt>
      <dd className="tnum text-ink-100">{v}</dd>
    </div>
  );
}

function CloseSection({ close }: { close: ReturnType<typeof buildCloseReport> }) {
  return (
    <section id="close" className="border-b hairline">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <SectionHead
          eyebrow="Close"
          title="The OS becomes a transaction commander"
          lede="Once terms are agreed, the value is not the checklist — it is knowing which incomplete item is actually on the critical path. A team that chases everything equally chases the wrong thing."
        />

        <div className="mt-14 grid gap-10 lg:grid-cols-[1fr_1fr]">
          <div>
            <div className="flex items-baseline gap-8">
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-ink-400">Close Score</p>
                <p className={`tnum font-display text-6xl ${scoreTone(close.closeScore)}`}>{close.closeScore}%</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-ink-400">Completion probability</p>
                <p className={`tnum font-display text-6xl ${scoreTone(close.completionProbability)}`}>
                  {close.completionProbability}%
                </p>
              </div>
            </div>
            <div className="mt-8 space-y-3">
              {close.sections.map((s) => (
                <div key={s.label}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-300">{s.label}</span>
                    <span className="tnum text-ink-200">{s.percent}%</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-800">
                    <div className={`h-full rounded-full ${scoreBg(s.percent)}`} style={{ width: `${s.percent}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">Blockers, ranked by what they hold up</p>
            <div className="mt-4 space-y-3">
              {close.blockers.slice(0, 4).map((b) => (
                <div
                  key={b.milestone.key}
                  className={`rounded-xl border px-5 py-4 ${b.severity === "red" ? "border-red-500/30 bg-red-500/5" : "border-amber-500/25 bg-amber-500/5"}`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${b.severity === "red" ? "bg-red-400" : "bg-amber-400"}`} />
                    <div>
                      <p className="text-sm text-ink-100">{b.message}</p>
                      <p className="mt-1 text-xs leading-relaxed text-ink-400">{b.action}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-5 text-sm text-ink-400">
              Critical path remaining: <span className="tnum text-ink-200">{close.criticalPathDays} days</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProtectionSection({ protection }: { protection: ReturnType<typeof runDealDirector>["scored"]["protection"] }) {
  return (
    <section className="border-b hairline bg-ink-900/30">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr]">
          <SectionHead
            eyebrow="Seller Protection"
            title="The engine can refuse the deal"
            lede="Motivated-seller acquisition has one obvious temptation: convert distress into discount. That route produces complaints, unenforceable contracts and enforcement action. Protection here is not advisory — a block stops the deal reaching capital at all."
          />
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-6 py-5">
              <p className="text-sm text-emerald-200">
                This deal: cleared. Independent advice and valuation evidenced, sole decision maker confirmed.
              </p>
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">
              Always disclosed to the seller before they can accept
            </p>
            <ul className="space-y-2.5">
              {protection.requiredDisclosures.map((d) => (
                <li key={d} className="flex gap-3 text-sm leading-relaxed text-ink-300">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lode-400" />
                  {d}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function RevenueSection({ revenue }: { revenue: ReturnType<typeof dealRevenue> }) {
  return (
    <section className="border-b hairline">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <SectionHead
          eyebrow="Business model"
          title="The seller is the supply engine, not the revenue"
          lede="Sellers enter free. Revenue comes from the dealmakers, capital and professionals that gather around the opportunity — and streams whose permissions are not held are shown at zero rather than assumed."
        />
        <div className="mt-12 overflow-hidden rounded-2xl border hairline">
          <table className="w-full text-sm">
            <thead className="bg-ink-900/60 text-left">
              <tr>
                <th className="px-6 py-3 font-medium text-ink-300">Stream on this transaction</th>
                <th className="px-6 py-3 text-right font-medium text-ink-300">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800/80">
              {revenue.lines.map((l) => (
                <tr key={l.stream} className={l.included ? "" : "opacity-50"}>
                  <td className="px-6 py-3.5 text-ink-200">
                    {l.label}
                    {!l.included && <span className="ml-2 text-xs text-amber-300/80">{l.excludedBecause}</span>}
                  </td>
                  <td className="tnum px-6 py-3.5 text-right text-ink-100">{gbp(l.amount)}</td>
                </tr>
              ))}
              <tr className="bg-ink-850/60">
                <td className="px-6 py-4 font-medium text-ink-200">Platform revenue, permissions as recorded</td>
                <td className="tnum px-6 py-4 text-right font-medium text-lode-200">{gbp(revenue.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-ink-400">{revenue.note}</p>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="border-b hairline bg-ink-900/30">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <SectionHead
          eyebrow="Pricing"
          title="Sellers free. Always."
          lede="You want thousands of motivated sellers entering the system, because exclusive deal flow is the asset. Friction at acquisition is the one thing that kills it."
        />
        <div className="mt-14 grid gap-4 md:grid-cols-3 lg:grid-cols-5">
          {BUYER_TIERS.map((t, i) => (
            <div
              key={t.name}
              className={`flex flex-col rounded-2xl border px-6 py-7 ${i === 2 ? "border-lode-500/40 bg-lode-400/5" : "hairline bg-ink-900/50"}`}
            >
              <p className="text-sm font-medium text-ink-100">{t.name}</p>
              <p className="tnum mt-3 font-display text-3xl text-ink-100">
                {t.monthly === 0 ? "Free" : gbp(t.monthly)}
                {t.monthly !== 0 && <span className="text-sm text-ink-400">/mo</span>}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-ink-400">{t.summary}</p>
              <ul className="mt-5 space-y-2 border-t hairline pt-5">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2 text-xs leading-relaxed text-ink-300">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-lode-400" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-ink-950">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <div className="rule-glow mb-16 h-px w-full" />
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <Mark />
              <span className="font-display text-2xl text-ink-100">Lode</span>
            </div>
            <p className="mt-5 max-w-md font-display text-2xl leading-snug text-ink-200">
              Problems become deals. Deals find capital. Capital closes property.
            </p>
          </div>
          <div className="rounded-xl border hairline bg-ink-900/40 px-6 py-5">
            <p className="text-[11px] uppercase tracking-[0.12em] text-ink-400">Regulatory position</p>
            <p className="mt-3 text-xs leading-relaxed text-ink-400">
              Figures shown are engine estimates for screening only and are not advice. Tax estimates
              require confirmation by a qualified adviser. Introducing sellers to buyers, and
              borrowers to lenders, are supervised activities in the UK — Lode does not charge those
              fees until the corresponding permissions are held. Rate tables are dated snapshots and
              must be re-verified each Budget.
            </p>
          </div>
        </div>
        <div className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t hairline pt-8">
          <p className="text-xs text-ink-500">
            © {new Date().getFullYear()} Lode. Property Deal OS. Not an estate agent, not a portal.
          </p>
          <Link href="/newsletter" className="text-xs text-ink-400 transition hover:text-lode-300">
            Get the weekly email →
          </Link>
        </div>
      </div>
    </footer>
  );
}

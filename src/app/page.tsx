import Link from "next/link";
import { runDealDirector } from "@shared/domain/director";
import { dealRevenue } from "@shared/domain/revenue";
import { HEAT_LABELS, scoreGoldMine } from "@shared/domain/goldmine";
import { buildCloseReport } from "@shared/domain/completion";
import { countInterestedBuyers, matchFundingBox, rankMatches } from "@shared/domain/matching";
import { SEED_BUY_BOXES, SEED_DEALS, SEED_FUNDING_BOXES } from "@backend/store/seed";
import { listBuyBoxes, listDeals, listFundingBoxes } from "@backend/store/repository";
import { scoreDeal } from "@shared/domain/dealScore";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { RECENT_DAYS, supplyPosition, type SupplyPosition } from "@shared/domain/supply";
import { add, sub, type Money } from "@shared/money";
import { buildSellerRoutes, type SellerRoutesReport } from "@shared/domain/sellerRoutes";
import { SiteFooter } from "@/app/components/SiteFooter";
import { gbp, gbpSigned, percent } from "@shared/format";
import { Button, Mark, scoreBg, scoreTone, VERDICT_TONE } from "@/app/components/chrome";
import { BUYER_TIERS } from "@shared/domain/revenue";
import { sellerFeeHeadline } from "@shared/domain/pricing";

/*
 * Recomputed at most every five minutes.
 *
 * The supply counts have to be live or they are worse than absent, but they do
 * not have to be to the second — and a landing page that cannot be cached at
 * all is a landing page that is slow for everybody to protect a number that
 * moves a few times a week.
 */
export const revalidate = 300;

/**
 * Landing page.
 *
 * Every figure on this page is computed by the engine at render time from the
 * seeded Erdington deal. Nothing is hardcoded copy dressed as a number — if
 * the appraisal changes, the marketing changes, which is the only honest way
 * to show a product whose whole claim is that its numbers are trustworthy.
 */

export default async function Home() {
  const record = SEED_DEALS[0];
  if (record === undefined) throw new Error("seed deal missing");

  /*
   * Supply, from the platform rather than from the fixtures.
   *
   * The worked example below is seeded and stays seeded — it is an example and
   * it is labelled as one. But the counts a visitor reads as "how big is this"
   * were also coming from the seed constants, on a page whose own comment
   * claims every figure is computed. An investor asking how many deals there
   * are was being shown a fixture.
   */
  const [liveDeals, liveBuyBoxes, liveFundingBoxes] = await Promise.all([
    listDeals(),
    listBuyBoxes(),
    listFundingBoxes(),
  ]);
  const supply = supplyPosition(
    liveDeals.map((d) => ({
      createdAt: d.createdAt,
      status: d.status,
      postcodeArea: d.property.postcodeArea,
      locality: d.property.locality,
      jurisdiction: d.property.jurisdiction,
      blocked: scoreDeal(toWorkingDeal(d.inputs).inputs).protection.blocked,
    })),
    {
      buy: liveBuyBoxes.filter((b) => b.active).length,
      funding: liveFundingBoxes.filter((b) => b.active).length,
    },
  );

  const briefing = runDealDirector(record.inputs);
  const { scored, stack, exits, recycle, strategies } = briefing;
  const buyers = countInterestedBuyers(SEED_BUY_BOXES, scored);
  const funders = rankMatches(
    SEED_FUNDING_BOXES.map((b) => matchFundingBox(b, scored, record.borrowerCompletedDeals)),
  );
  const close = buildCloseReport(record.milestones ?? []);
  const revenue = dealRevenue(scored.appraisal);
  const goldmine = record.listing !== undefined ? scoreGoldMine(record.listing, record.property) : undefined;
  // The seller's own view of the same deal, so the hero can show what a seller
  // receives rather than what a buyer makes.
  const sellerRoutes = buildSellerRoutes(record.property, record.seller);

  const stress = (key: string): Money =>
    scored.redTeam.results.find((r) => r.stress.key === key)?.profit ?? scored.appraisal.profit;

  return (
    <main className="relative overflow-x-hidden">
      <Nav />
      <Hero routes={sellerRoutes} supply={supply} />
      <Doors />
      <SupplySection supply={supply} />
      <LiveDeal
        briefing={briefing}
        buyers={buyers}
        funderCount={funders.length}
        topFunder={funders[0]?.target.funderName}
      />
      <ProtectionSection protection={scored.protection} />
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
      <RevenueSection revenue={revenue} />
      <Pricing />
      <SiteFooter />
    </main>
  );
}

// ---------------------------------------------------------------------------

function Nav() {
  return (
    <nav className="app-header sticky top-0 z-50 border-b hairline bg-ink-950/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-3">
        <div className="flex items-center gap-2.5">
          <Mark size={19} />
          <span className="font-display text-[17px] tracking-[-0.01em] text-ink-100">Lode</span>
        </div>
        <div className="hidden items-center gap-7 text-[13px] text-ink-400 lg:flex">
          <Link href="/appraise" className="transition-colors hover:text-ink-100">Free appraisal</Link>
          <Link href="/sell" className="transition-colors hover:text-ink-100">Selling</Link>
          <Link href="/partners" className="transition-colors hover:text-ink-100">Agents</Link>
          <a href="#engine" className="transition-colors hover:text-ink-100">Deal Engine</a>
          <a href="#stack" className="transition-colors hover:text-ink-100">Capital</a>
          <a href="#goldmine" className="transition-colors hover:text-ink-100">GoldMine</a>
          <a href="#close" className="transition-colors hover:text-ink-100">Close</a>
          <a href="#pricing" className="transition-colors hover:text-ink-100">Pricing</a>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/operator"
            className="hidden px-2 text-[13px] text-ink-400 transition-colors hover:text-ink-100 sm:block"
          >
            Sign in
          </Link>
          <Button href="/appraise" variant="primary" size="sm">Appraise a deal</Button>
        </div>
      </div>
    </nav>
  );
}


function Hero({ routes, supply }: { routes: SellerRoutesReport; supply: SupplyPosition }) {
  return (
    <section className="grain relative border-b hairline">
      <div className="relative mx-auto grid max-w-7xl items-start gap-14 px-6 py-14 lg:grid-cols-[1fr_480px] lg:py-18">
        <div className="max-w-[40rem]">
          <p className="eyebrow">For motivated sellers</p>

          {/*
            No coloured word in the middle of the sentence. Highlighting one
            word in the accent is the single most recognisable template move
            there is, and the sentence is strong enough without it.
          */}
          <h1 className="mt-5 font-display text-[33px] font-normal leading-[1.08] tracking-[-0.02em] text-ink-100 sm:text-[44px] lg:text-[52px] lg:tracking-[-0.025em]">
            Don&apos;t list your property.
            <br />
            Solve your property problem.
          </h1>

          <p className="mt-6 max-w-[33rem] text-[16px] leading-[1.6] text-ink-300">
            Lode is not a portal. It is a deal engine. Sellers bring a situation, dealmakers bring
            the opportunity, funders bring the capital — and the OS structures a transaction that
            survives tax, stress testing and completion.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <Button href="/sell" variant="primary">See my options — free</Button>
            <Button href="/appraise">Appraise a deal instead</Button>
          </div>
          <p className="mt-3 text-[13px] text-ink-500">
            Seeing your options is free and nobody phones you unless you ask. If you go on to sell
            through us we charge {sellerFeeHeadline()} — and nothing at all if it does not sell.
            Buying rather than selling? The appraisal needs no account.
          </p>

          {/*
            Read from the platform, not from the seed constants these used to
            come from. A visitor reads these as "how big is this", so a fixture
            in this position is the first thing they would find out was untrue.
          */}
          <dl className="mt-12 grid max-w-lg grid-cols-3 gap-8 border-t hairline pt-7">
            <HeroStat
              label="Open opportunities"
              value={String(supply.open)}
              sub={
                supply.areas.length === 0
                  ? "none on the platform yet"
                  : supply.areas.length === 1
                    ? `in ${supply.areas[0]}`
                    : `across ${supply.areas.length} postcode areas`
              }
            />
            <HeroStat
              label="Capital mandates"
              value={String(supply.fundingMandates)}
              sub={`${supply.buyMandates} buying mandate${supply.buyMandates === 1 ? "" : "s"} alongside`}
            />
            <HeroStat label="Strategies tested" value="14" sub="per property, before advice" />
          </dl>
        </div>

        <SellerRoutesCard report={routes} />
      </div>
    </section>
  );
}

function HeroStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.09em] text-ink-400">{label}</dt>
      <dd className="tnum mt-1.5 text-[26px] leading-none text-ink-100">{value}</dd>
      <dd className="mt-1.5 text-xs leading-snug text-ink-500">{sub}</dd>
    </div>
  );
}

/**
 * The hero's product surface.
 *
 * Deliberately a real screen rather than an illustration of one: the same
 * figures the Deal Room shows, in the same order, at the same density. A
 * marketing card that summarises a product in three words tells a visitor
 * nothing about whether they want it; a screen tells them immediately.
 *
 * The score used to be drawn as a ring around a number, which is the shape
 * every dashboard template ships with and which encodes one value in a
 * hundred-odd pixels. It is now the number, its band, and a rule — legible at
 * a glance and honest about being one figure.
 */
/**
 * The hero's product surface.
 *
 * It used to show the buyer's cost stack and the profit on the deal, which is
 * the wrong thing to put in front of the audience the headline is addressing.
 * A homeowner in probate, two screens into the page, was being shown what a
 * stranger would make out of their mother's house before they had said a word.
 * Transparency about the buyer's margin is right, and it is right *in the
 * seller's own results*, where it sits beside what they gain for it. On a cold
 * landing page with no context it is a deterrent.
 *
 * So this is the seller's view: what each route pays, how fast, and what it
 * costs them. The buyer's arithmetic is a click away at /appraise, where the
 * audience for it is the audience that asked.
 */
function SellerRoutesCard({ report }: { report: SellerRoutesReport }) {
  const routes = report.routes.filter((r) => !r.unavailable).slice(0, 3);
  const best = report.best;

  return (
    <div className="overflow-hidden rounded-xl border hairline bg-surface-1">
      <div className="flex items-center justify-between border-b hairline bg-surface-2 px-4 py-2.5">
        <span className="font-mono text-[11px] tracking-[0.04em] text-ink-300">
          Probate · Erdington B23 · empty 412 days
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-500">
          Worked example
        </span>
      </div>

      <div className="px-5 py-4">
        <p className="text-[13px] leading-[1.6] text-ink-300">
          Four routes, ranked against what this seller said mattered — not against which one pays
          us most. This is what each one puts in their hand.
        </p>
        <p className="mt-2 text-[12px] leading-[1.6] text-ink-500">
          A worked example, not a live listing. The figures are computed by the same engine at the
          moment you loaded this page — change the inputs and every number below changes — but the
          property is an illustration.
        </p>
      </div>

      <ul className="border-t hairline">
        {routes.map((route) => (
          <li key={route.key} className="border-b hairline px-5 py-3.5 last:border-0">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-[14px] text-ink-100">{route.label}</span>
              <span className="tnum shrink-0 text-[15px] text-lode-300">
                {gbp(route.totalToSeller)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 text-[12px] text-ink-500">
              <span>
                {route.completionDaysMin}–{route.completionDaysMax} days
                {best !== undefined && best.key === route.key && (
                  <span className="ml-2 text-lode-400">best fit for what they told us</span>
                )}
              </span>
              <span className="tnum">{route.certainty} certainty</span>
            </div>
          </li>
        ))}
      </ul>

      <div className="border-t hairline bg-surface-2 px-5 py-3.5">
        <p className="text-[12px] leading-[1.6] text-ink-400">
          Every route also shows what the seller gives up for it, including that an agent would
          probably get them more. That is not a disclaimer we add — the engine refuses to produce a
          below-market route without it.
        </p>
      </div>
    </div>
  );
}

/**
 * Who this is for, and where each of them goes.
 *
 * Two things were wrong with this before. It was the fourth thing on the page,
 * behind a hero and a product screen, so a reader who was not a seller had to
 * work out from context whether to keep going. And **none of the five was a
 * link** — each was a div with an arrow drawn after it, so the only audience
 * segmentation on the site did nothing at all when clicked.
 *
 * Estate agents were missing entirely, which was the worse omission. An agent
 * with a probate instruction that has been on the market four hundred days
 * through three reductions has a client they cannot serve and a fee they will
 * never earn — which is exactly the supply this platform needs. Reading a page
 * whose headline is "don't list your property" and whose engine audits why
 * their listings failed, they saw a competitor.
 */
function Doors() {
  const doors = [
    {
      tag: "Sell",
      title: "I have a property problem",
      body: "Tell us the situation, not the asking price. You get costed routes — cash, deferred, JV or assisted sale — and what each one costs you. Free, and nobody phones you unless you ask.",
      cta: "See my options",
      href: "/sell",
    },
    {
      tag: "Buy",
      title: "I appraise deals",
      body: "Start with the free appraisal: paste a deal and get the true discount after every cost, the price to walk away above, and the single stress that breaks it. No account.",
      cta: "Appraise a deal",
      href: "/appraise",
    },
    {
      tag: "Fund",
      title: "I have capital",
      body: "Set a Funding Box and receive only deals inside your mandate, with the underwriting done, the downside modelled and the regulatory route already classified.",
      cta: "How funding works",
      href: "/partners#capital",
    },
    {
      tag: "Refer",
      title: "I am an agent or a professional",
      body: "You have instructions you cannot close. Refer them, keep a fee, keep the client — and get back the ones we cannot help either.",
      cta: "Refer an instruction",
      href: "/partners",
    },
  ];

  return (
    <section className="border-b hairline bg-surface-1">
      <div className="mx-auto grid max-w-7xl gap-px overflow-hidden sm:grid-cols-2 lg:grid-cols-4">
        {doors.map((d) => (
          <Link
            key={d.tag}
            href={d.href}
            className="group border-b border-r hairline px-6 py-8 transition-colors last:border-r-0 hover:bg-surface-2"
          >
            <span className="eyebrow">{d.tag}</span>
            <h3 className="mt-3 font-display text-[19px] leading-snug text-ink-100">{d.title}</h3>
            <p className="mt-2.5 text-[13px] leading-[1.6] text-ink-400">{d.body}</p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-lode-300 transition-all group-hover:gap-2.5">
              {d.cta}
              <span aria-hidden>&rarr;</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * How many, where, how often.
 *
 * The three questions an investor asks before any of the engine matters, and
 * the page answered none of them. It answers them here from the platform's own
 * records, and it is allowed to answer "four" — a reader who cannot find a
 * number assumes the worst one, and a small number stated plainly is more
 * persuasive than a large one they cannot check.
 *
 * No return, yield or margin appears anywhere in it. A public statement that
 * deals are available at a given margin is an inducement to engage in
 * investment activity, and under FSMA s.21 only an authorised person may
 * communicate or approve one. Counts, coverage and cadence are facts about the
 * business; the economics stay behind categorisation, where `can()` puts them.
 */
function SupplySection({ supply }: { supply: SupplyPosition }) {
  return (
    <section id="supply" className="border-b hairline">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="eyebrow">Deal flow</p>
            <h2 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
              How many, where, and how often.
            </h2>
            <p className="mt-5 max-w-[34rem] text-[15px] leading-[1.6] text-ink-300">
              The three questions worth asking before any of the analysis matters, because an
              appraisal engine with nothing behind it is a spreadsheet with better manners. These
              are counted from the platform when this page is built, not written by hand.
            </p>
            <p className="mt-4 max-w-[34rem] text-[14px] leading-[1.6] text-ink-400">
              {supply.summary}
            </p>
          </div>

          <div>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-3">
              <HeroStat
                label="Open now"
                value={String(supply.open)}
                sub={`of ${supply.total} on the platform`}
              />
              <HeroStat
                label="Postcode areas"
                value={String(supply.areas.length)}
                sub={supply.areas.length > 0 ? supply.areas.join(", ") : "none yet"}
              />
              <HeroStat
                label={`Added in ${RECENT_DAYS} days`}
                value={String(supply.recent)}
                sub={
                  supply.tooEarlyForCadence
                    ? "too early for a rate"
                    : `about one every ${supply.meanDaysBetween ?? 0} days`
                }
              />
              <HeroStat
                label="Refused"
                value={String(supply.blocked)}
                sub="stopped by Seller Protection"
              />
              <HeroStat
                label="Buying mandates"
                value={String(supply.buyMandates)}
                sub="active Buy Boxes"
              />
              <HeroStat
                label="Capital mandates"
                value={String(supply.fundingMandates)}
                sub="active Funding Boxes"
              />
            </dl>

            <div className="mt-8 rounded-lg border-l-2 border-lode-500/80 bg-surface-1 px-5 py-4">
              <p className="text-[13px] leading-[1.65] text-ink-300">
                <span className="text-ink-100">This is early, and it is stated rather than
                implied.</span>{" "}
                Supply is the constraint on this business, not analysis — so the honest thing to
                show a buyer is the number, and the honest thing to do about it is recruit the
                agents who hold the instructions nobody can close.{" "}
                <Link href="/partners" className="text-lode-300 underline underline-offset-2">
                  That is what the referral route is for
                </Link>
                .
              </p>
            </div>

            <p className="mt-4 text-[12px] leading-[1.6] text-ink-500">
              What each deal is worth is not shown here and will not be. A public statement that
              opportunities are available at a given return is a financial promotion, and one may
              only be made or approved by a person authorised under FSMA. The economics are behind
              investor categorisation, which is a form you sign rather than a box you tick.
            </p>
          </div>
        </div>
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
      <div className="mx-auto max-w-7xl px-6 py-20">
        <SectionHead
          eyebrow="Deal Engine · worked example"
          title="The number most sourcers never show you"
          lede={`A property bought at ${gbp(a.costs.purchasePrice)} and worth ${gbp(a.exit.grossDevelopmentValue)} finished is not a ${gbp(naiveProfit)} profit. Lode charges every cost, then charges the tax, and only then scores the deal.`}
        />

        <div className="mt-14 grid items-start gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border hairline bg-surface-2">
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
            <div className="rounded-xl border hairline bg-surface-2 px-5 py-4">
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
              {/* Said explicitly, because this figure sits a screen below the
                  live platform counts and would otherwise be read as one. */}
              <p className="mt-2 text-xs leading-relaxed text-ink-500">
                Matched against the example mandates in this walkthrough. The platform&rsquo;s real
                counts are in{" "}
                <Link href="#supply" className="text-ink-400 underline underline-offset-2">
                  deal flow
                </Link>
                , above.
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
    <div className={`rounded-xl border px-5 py-4 ${accent ? "border-lode-500/40 bg-lode-400/10" : "hairline bg-surface-2"}`}>
      <p className="eyebrow">{label}</p>
      <p className={`tnum mt-1 text-[24px] leading-none ${accent ? "text-lode-200" : muted ? "text-ink-300" : "text-ink-100"}`}>
        {value}
      </p>
    </div>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border hairline bg-surface-1 px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.12em] text-ink-400">{label}</p>
      <p className="tnum mt-1 text-xl text-ink-100">{value}</p>
      {hint !== undefined && <p className="mt-0.5 text-[10px] text-ink-400">{hint}</p>}
    </div>
  );
}

function SectionHead({ eyebrow, title, lede }: { eyebrow: string; title: string; lede: string }) {
  return (
    <div className="max-w-3xl">
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">{title}</h2>
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
    <section className="border-b hairline bg-surface-1">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <div className="grid gap-14 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <SectionHead
              eyebrow="Deal Score"
              title="Nine components. Every one auditable."
              lede="A score a lender cannot interrogate is worth nothing to them. Each component carries the reasoning that produced it."
            />
            <div className="mt-10 flex items-baseline gap-3">
              <span className={`tnum text-[56px] leading-none ${scoreTone(composite)}`}>{composite}</span>
              <span className="text-2xl text-ink-500">/100</span>
            </div>
          </div>

          <div className="space-y-3">
            {components.map((c) => (
              <div key={c.key} className="rounded-xl border hairline bg-surface-2 px-5 py-4">
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
      <div className="mx-auto max-w-7xl px-6 py-20">
        <SectionHead
          eyebrow="AI Red Team"
          title="An independent agent tries to destroy the deal"
          lede="Before any pack reaches a funder, nine fixed stress scenarios run against it. Lenders see the downside at the same moment they see the headline — and every deal on Lode is shocked identically, so they compare."
        />

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {scenarios.map((s) => (
            <div
              key={s.label}
              className={`rounded-xl border px-5 py-6 ${s.value < 0 ? "border-red-500/40 bg-red-500/5" : "hairline bg-surface-2"}`}
            >
              <p className="eyebrow">{s.label}</p>
              <p className={`tnum mt-2 text-[24px] leading-none ${s.value < 0 ? "text-red-300" : "text-ink-100"}`}>
                {gbpSigned(s.value)}
              </p>
              <p className="mt-2.5 text-xs leading-snug text-ink-400">{s.note}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-6 rounded-xl border hairline bg-surface-1 px-5 py-4">
          <div>
            <p className="eyebrow">Resilience</p>
            <p className={`tnum text-[24px] leading-none ${scoreTone(resilience)}`}>{resilience}/100</p>
          </div>
          <p className="max-w-2xl flex-1 text-sm leading-relaxed text-ink-300">{summary}</p>
        </div>
      </div>
    </section>
  );
}

function StackSection({ stack }: { stack: ReturnType<typeof runDealDirector>["stack"] }) {
  return (
    <section id="stack" className="border-b hairline bg-surface-1">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <SectionHead
          eyebrow="Capital Stack"
          title="Bring the deal. Not necessarily the deposit."
          lede="The capital does not disappear — someone provides every pound and prices it. Lode assembles that stack around a viable transaction and states plainly what the originator is really contributing."
        />

        <div className="mt-14 grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-3">
            {stack.layers.map((l) => (
              <div key={l.kind} className="rounded-xl border hairline bg-surface-2 px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-ink-100">{l.label}</span>
                  <span className="tnum text-[21px] leading-none text-lode-200">{gbp(l.amount)}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink-400">{l.note}</p>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-lg border-l-2 border-lode-500/80 bg-surface-1 px-5 py-4">
              <span className="text-sm text-ink-200">Originator cash required</span>
              <span className="tnum text-[21px] leading-none text-lode-200">{gbp(stack.originatorCash)}</span>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border hairline bg-surface-2 px-5 py-5">
              <p className="eyebrow">Originator retains</p>
              <p className="tnum mt-1 text-[30px] leading-none text-ink-100">{percent(stack.originatorShareBps, 0)}</p>
              <p className="mt-2 text-xs text-ink-400">of residual profit, for sourcing, negotiation and execution</p>
            </div>
            {stack.warnings.slice(0, 3).map((w) => (
              <div key={w} className="rounded-lg border-l-2 border-amber-500/80 bg-surface-1 px-5 py-4">
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
      <div className="mx-auto max-w-7xl px-6 py-20">
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
                <div key={`${s.candidate.structure}-${s.candidate.exit}`} className="rounded-xl border hairline bg-surface-2 px-5 py-4">
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
            <div className="rounded-2xl border hairline bg-surface-2 p-6">
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

            <div className="rounded-2xl border hairline bg-surface-2 p-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400">Capital recycling</p>
              <p className="tnum mt-2 text-[30px] leading-none text-ink-100">{percent(recycle.recycledBps, 0)}</p>
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
  return <span className={`rounded-md border px-3 py-1 ${tones[tone]}`}>{children}</span>;
}

function GoldMineSection({
  goldmine,
  listing,
}: {
  goldmine: ReturnType<typeof scoreGoldMine>;
  listing: { daysOnMarket: number; priceReductions: number; agentCount: number; relistCount: number };
}) {
  return (
    <section id="goldmine" className="border-b hairline bg-surface-1">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <SectionHead
          eyebrow="AI Property GoldMine"
          title="Why has this property not sold?"
          lede="Time on market alone is weak evidence. A year at an unchanged price means a stubborn seller. A year of repeated reductions and relistings means someone actively trying and failing — a real problem the platform can solve."
        />

        <div className="mt-14 grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-2xl border hairline bg-surface-2 p-7">
            <div className="flex items-center justify-between">
              <span className="rounded-md border border-lode-500/40 bg-lode-400/10 px-3 py-1 text-xs text-lode-200">
                {HEAT_LABELS[goldmine.heat]}
              </span>
              <span className="tnum text-[30px] leading-none text-lode-200">{goldmine.score}</span>
            </div>
            <dl className="mt-6 space-y-3 border-t hairline pt-5 text-sm">
              <Row k="Days on market" v={String(listing.daysOnMarket)} />
              <Row k="Price reductions" v={String(listing.priceReductions)} />
              <Row k="Agents used" v={String(listing.agentCount)} />
              <Row k="Relistings" v={String(listing.relistCount)} />
              <Row k="Seller pressure" v={`${goldmine.pressure.score}/100`} />
            </dl>
            <div className="mt-6 border-t hairline pt-5">
              <p className="eyebrow">Suggested approach</p>
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
            <p className="mt-7 rounded-xl border hairline bg-surface-2 px-5 py-4 text-sm leading-relaxed text-ink-300">
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
      <div className="mx-auto max-w-7xl px-6 py-20">
        <SectionHead
          eyebrow="Close"
          title="The OS becomes a transaction commander"
          lede="Once terms are agreed, the value is not the checklist — it is knowing which incomplete item is actually on the critical path. A team that chases everything equally chases the wrong thing."
        />

        <div className="mt-14 grid gap-10 lg:grid-cols-[1fr_1fr]">
          <div>
            <div className="flex items-baseline gap-8">
              <div>
                <p className="eyebrow">Close Score</p>
                <p className={`tnum text-[44px] leading-none ${scoreTone(close.closeScore)}`}>{close.closeScore}%</p>
              </div>
              <div>
                <p className="eyebrow">Completion probability</p>
                <p className={`tnum text-[44px] leading-none ${scoreTone(close.completionProbability)}`}>
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
    <section className="border-b hairline bg-surface-1">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr]">
          <SectionHead
            eyebrow="Seller Protection"
            title="The engine can refuse the deal"
            lede="Motivated-seller acquisition has one obvious temptation: convert distress into discount. That route produces complaints, unenforceable contracts and enforcement action. Protection here is not advisory — a block stops the deal reaching capital at all."
          />
          <div className="space-y-4">
            <div className="rounded-lg border-l-2 border-emerald-500/80 bg-surface-1 px-5 py-4">
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
      <div className="mx-auto max-w-7xl px-6 py-20">
        <SectionHead
          eyebrow="Business model"
          title="The seller is the supply engine, not the revenue"
          lede="Sellers enter free. Revenue comes from the dealmakers, capital and professionals that gather around the opportunity — and streams whose permissions are not held are shown at zero rather than assumed."
        />
        <div className="mt-12 overflow-hidden rounded-2xl border hairline">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left">
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
    <section id="pricing" className="border-b hairline bg-surface-1">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <SectionHead
          eyebrow="Pricing"
          title="Sellers free. Always."
          lede="You want thousands of motivated sellers entering the system, because exclusive deal flow is the asset. Friction at acquisition is the one thing that kills it."
        />
        <div className="mt-14 grid gap-4 md:grid-cols-3 lg:grid-cols-5">
          {BUYER_TIERS.map((t, i) => (
            <div
              key={t.name}
              className={`flex flex-col rounded-2xl border px-6 py-7 ${i === 2 ? "border-lode-500/40 bg-lode-400/5" : "hairline bg-surface-2"}`}
            >
              <p className="text-sm font-medium text-ink-100">{t.name}</p>
              <p className="tnum mt-2 text-[24px] leading-none text-ink-100">
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


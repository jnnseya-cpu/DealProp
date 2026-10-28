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
import {
  focusCoverage,
  LAUNCH_FOCUS,
  RECENT_DAYS,
  supplyPosition,
  type SupplyPosition,
} from "@shared/domain/supply";
import { add, sub, type Money } from "@shared/money";
import { buildSellerRoutes, type SellerRoutesReport } from "@shared/domain/sellerRoutes";
import { SiteFooter } from "@/app/components/SiteFooter";
import { gbp, gbpSigned, percent } from "@shared/format";
import { Button, Mark, scoreBg, scoreTone, VERDICT_TONE } from "@/app/components/chrome";
import { LandingNav } from "@/app/components/LandingNav";
import { Meter, StackedBar, type StackSegment } from "@/app/components/charts";
import { BUYER_TIERS } from "@shared/domain/revenue";
import { sellerFeeStatement, type SellerFeeStatement } from "@shared/domain/fees";
import { mayPublishReturns, type PromotionDecision } from "@shared/domain/prohibitions";
import { permissionsHeld } from "@backend/permissions";
import { situationLabel } from "@shared/domain/motivation";
import { REVEAL_GUARANTEE } from "@shared/domain/reveal";
import { GRADES } from "@shared/domain/passport";
import { MATERIAL_ITEMS } from "@shared/domain/materialInformation";
import { sellerDueDiligence } from "@shared/domain/sellerDueDiligence";
import { REVEAL_PRICES } from "@shared/domain/pricing";
import type { OccupancyStatus } from "@shared/domain/types";

/**
 * A Record rather than a ternary, so a fourth occupancy status is a type error
 * here instead of being quietly described as owner-occupied on the front page.
 */
const OCCUPANCY_LABELS: Record<OccupancyStatus, string> = {
  vacant: "vacant",
  "owner-occupied": "owner-occupied",
  tenanted: "tenanted",
  "tenanted-arrears": "tenanted, arrears",
  unknown: "occupancy not recorded",
};

/*
 * Rendered per request, not prerendered at build.
 *
 * This page prints the statutory company identity (in the footer) and the live
 * supply counts, both of which are RUNTIME configuration — `COMPANY_*` and
 * `DATABASE_URL` live in the VPS's app.env and are deliberately never baked into
 * the image (only NEXT_PUBLIC_* may be a build arg). Prerendering this page at
 * build time therefore captured an empty identity and an empty store, and then
 * served that stale HTML even though the real values exist at runtime — which is
 * why the footer showed "company identity has not been configured" on a site
 * whose identity was in fact set. Rendering per request reads the live env, so
 * the footer and the counts reflect what is actually configured. The engine
 * work here is pure and the one store read is cheap.
 */
export const dynamic = "force-dynamic";

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
    // Unbounded deliberately. The supply statement answers "how many are there", and a partial answer to that is a wrong answer. Affordable because this page is ISR-cached at 300s, so the scan runs about twelve times an hour however much traffic arrives.
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
  // The worked example, described from the record it is computed from rather
  // than from a string somebody typed above it.
  const subject = [
    situationLabel(record.seller.situation),
    `${record.property.locality} ${record.property.postcodeArea}`,
    OCCUPANCY_LABELS[record.property.occupancy],
  ].join(" · ");

  // Whether a return figure may be shown to somebody who is not signed in.
  // Read from the same permission catalogue that gates the revenue model and
  // the fee engine, so there is one answer to "are we authorised to say this".
  const permissions = permissionsHeld();
  const promotion = mayPublishReturns(permissions);
  // What a seller will actually pay, decided by the fee engine rather than by
  // whoever last edited this paragraph.
  const sellerFee = sellerFeeStatement(permissions);

  const stress = (key: string): Money =>
    scored.redTeam.results.find((r) => r.stress.key === key)?.profit ?? scored.appraisal.profit;

  return (
    <main className="relative overflow-x-hidden">
      <Nav />
      <Hero
        sellerFee={sellerFee}
        routes={sellerRoutes}
        supply={supply}
        subject={subject}
        strategiesTested={strategies.tested}
        scoreComponents={scored.breakdown.components.length}
        stressScenarios={scored.redTeam.results.length}
        score={scored.breakdown.composite}
        stack={stack}
      />
      <AudienceBand />
      <Doors />
      <SupplySection supply={supply} promotion={promotion} />
      <LiveDeal
        briefing={briefing}
        buyers={buyers}
        funderCount={funders.length}
        topFunder={funders[0]?.target.funderName}
      />
      <TrustSection />
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
        <LandingNav />
        <div className="flex items-center gap-2">
          <Link
            href="/operator"
            className="hidden px-2 text-[13px] text-ink-400 transition-colors hover:text-ink-100 lg:block"
          >
            Sign in
          </Link>
          <Link
            href="/join"
            className="hidden px-2 text-[13px] text-ink-400 transition-colors hover:text-ink-100 lg:block"
          >
            Create account
          </Link>
          <Button href="/appraise" variant="primary" size="sm">Appraise a deal</Button>
        </div>
      </div>
    </nav>
  );
}


function Hero({
  routes,
  supply,
  subject,
  strategiesTested,
  scoreComponents,
  stressScenarios,
  sellerFee,
  score,
  stack,
}: {
  routes: SellerRoutesReport;
  supply: SupplyPosition;
  subject: string;
  strategiesTested: number;
  scoreComponents: number;
  stressScenarios: number;
  sellerFee: SellerFeeStatement;
  score: number;
  stack: ReturnType<typeof runDealDirector>["stack"];
}) {
  // Three stats, and never a zero. Real supply leads where it exists; where it
  // is genuinely empty the row backfills with computed facts about the engine
  // itself — all true, none invented — so a cold first screen reads strong
  // rather than showing a stranger a line of noughts. The honest supply counts
  // (including the zeros, with context) still live in the Deal flow section.
  type Stat = { label: string; value: string; sub: string };
  const supplyStats: Stat[] = [];
  if (supply.open > 0) {
    supplyStats.push({
      label: "Open opportunities",
      value: String(supply.open),
      sub:
        supply.areas.length === 0
          ? "live now"
          : supply.areas.length === 1
            ? `in ${supply.areas[0]}`
            : `across ${supply.areas.length} postcode areas`,
    });
  }
  if (supply.fundingMandates > 0) {
    supplyStats.push({
      label: "Capital mandates",
      value: String(supply.fundingMandates),
      sub: `${supply.buyMandates} buying mandate${supply.buyMandates === 1 ? "" : "s"} alongside`,
    });
  } else if (supply.buyMandates > 0) {
    supplyStats.push({ label: "Buying mandates", value: String(supply.buyMandates), sub: "active Buy Boxes" });
  }
  const capabilityStats: Stat[] = [
    { label: "Strategies tested", value: String(strategiesTested), sub: "per property, before advice" },
    { label: "Stress scenarios", value: String(stressScenarios), sub: "run on every deal" },
    { label: "Score components", value: String(scoreComponents), sub: "each one auditable" },
  ];
  const stats = [...supplyStats, ...capabilityStats].slice(0, 3);

  return (
    <section className="grain relative overflow-hidden border-b hairline">
      {/*
        Cinematic light — a low, warm sun raking across a dark field, plus a
        cold fill from the far side. Static and CSS-only: no animation to
        distract from the console, and nothing that pins a slow landing page to
        a repaint. This is the one place the page earns its atmosphere.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 55% at 82% 8%, rgba(201,164,78,0.16), transparent 60%), radial-gradient(85% 70% at 6% 0%, rgba(96,116,150,0.09), transparent 55%)",
        }}
      />
      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-6 py-16 lg:grid-cols-[0.92fr_1.08fr] lg:py-24">
        <div className="min-w-0 max-w-[40rem]">
          <p className="eyebrow">The operating system for property deals</p>

          {/*
            No coloured word in the middle of the sentence — highlighting one
            word in the accent is the single most recognisable template move
            there is, and the sentence carries itself.
          */}
          <h1 className="mt-5 font-display text-[38px] font-normal leading-[1.02] tracking-[-0.025em] text-ink-100 sm:text-[52px] lg:text-[62px] lg:tracking-[-0.03em]">
            Don&apos;t list your property.
            <br />
            Solve your property problem.
          </h1>

          <p className="mt-6 max-w-[34rem] text-[16px] leading-[1.6] text-ink-300">
            Not a portal — a deal engine. Tell it your situation and it computes one honest position:
            the score, the routes, the capital and the law, carried through to completion in sixty days.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <Button href="/sell" variant="primary">See my options — free</Button>
            <Button href="/appraise">Appraise a deal instead</Button>
          </div>
          {/*
            The free promise, hammered but honest. The headline word is fixed —
            "free" is the message the business wants loudest — but the sentence
            under it is the fee engine's own statement, computed from the
            permissions actually held, so the loud claim and the true one are the
            same claim. When a success fee becomes chargeable the statement below
            changes itself; the badge stays true because "no upfront fee" holds
            in both states.
          */}
          <div className="mt-6 flex items-start gap-3.5 rounded-xl border border-lode-500/25 bg-lode-400/[0.06] px-4 py-3.5">
            <span className="mt-px shrink-0 rounded-md border border-lode-500/40 bg-lode-400/10 px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-lode-200">
              Free to sell
            </span>
            <p className="text-[13.5px] leading-[1.55] text-ink-200">
              {sellerFee.statement} No listing fee, no upfront cost, and nobody phones you unless you ask.
            </p>
          </div>

          {/*
            Real supply where it exists (read from the platform, never a
            fixture), backfilled with computed engine facts so the row is never
            a line of zeros to a cold visitor. The full honest counts — zeros and
            all, with context — are in the Deal flow section below.
          */}
          <dl className="mt-11 grid max-w-lg grid-cols-3 gap-8 border-t hairline pt-7">
            {stats.map((s) => (
              <HeroStat key={s.label} label={s.label} value={s.value} sub={s.sub} />
            ))}
          </dl>
        </div>

        <OSConsole routes={routes} subject={subject} score={score} stack={stack} />
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
 * The hero's product surface — the operating console.
 *
 * A real screen rather than an illustration of one: the same figures the Deal
 * Room shows, framed as the application they live in. Two house rules survive
 * the restyle and must not be undone:
 *
 *  - The score is the number, its band and a rule — never a ring. A ring is the
 *    shape every dashboard template ships with and encodes one value in a
 *    hundred pixels; `scoreBg`/`scoreTone` colour it from the same thresholds as
 *    the verdict, so the number and its bar cannot disagree.
 *  - The routes are the *seller's* view — what each pays, how fast, what it
 *    costs them. The capital stack shown below is the deal's funding structure
 *    (who provides each pound), not the buyer's profit: the margin a stranger
 *    makes stays out of a cold landing page, where it reads as a deterrent.
 *
 * Every figure is computed by the engine at render from the seeded example;
 * change the inputs and the console changes.
 */
function OSConsole({
  routes,
  subject,
  score,
  stack,
}: {
  routes: SellerRoutesReport;
  subject: string;
  score: number;
  stack: ReturnType<typeof runDealDirector>["stack"];
}) {
  const top = routes.routes.filter((r) => !r.unavailable).slice(0, 3);
  const best = routes.best;
  const band = score >= 78 ? "Strong" : score >= 60 ? "Workable" : score >= 40 ? "Marginal" : "Below floor";

  // The capital stack as parts of a whole — shades of the one accent, each
  // named directly in the legend so identity never rests on colour alone.
  const shades = ["bg-lode-500", "bg-lode-500/55", "bg-lode-400/35", "bg-surface-3"];
  const segments: StackSegment[] = stack.layers.map((l, i) => ({
    label: l.label,
    value: Math.max(Number(l.amount), 0),
    display: gbp(l.amount),
    fill: shades[i % shades.length]!,
  }));

  return (
    <div className="relative min-w-0">
      <div className="overflow-hidden rounded-2xl border hairline bg-surface-1 shadow-[0_50px_120px_-55px_rgba(0,0,0,0.9)]">
        {/* application chrome */}
        <div className="flex items-center justify-between gap-3 border-b hairline bg-ink-950/60 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5 text-[12px] text-ink-400">
            <Mark size={15} />
            <span className="text-ink-200">Pipeline</span>
            <span className="text-ink-600">/</span>
            <span className="truncate font-mono text-[11px] text-ink-300">{subject}</span>
          </div>
          <span className="shrink-0 rounded-full border border-emerald-600/40 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-emerald-300">
            Live
          </span>
        </div>

        <div className="space-y-4 p-5">
          {/* position — number, band and a rule, never a ring */}
          <div className="flex items-start justify-between gap-4">
            <div className="max-w-[20rem]">
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-500">Deal position · Worked example</p>
              <p className="mt-1 text-[13px] leading-[1.5] text-ink-300">
                Four routes, ranked against what this seller said mattered — not against which pays us most.
              </p>
            </div>
            <div className="shrink-0 text-right">
              <span className={`tnum font-display text-[42px] leading-none ${scoreTone(score)}`}>{score}</span>
              <p className="mt-1 text-[11px] text-ink-400">{band}, after tax</p>
            </div>
          </div>
          <Meter value={score} fill={scoreBg(score)} />

          {/* seller routes — real */}
          <ul className="rounded-xl border hairline bg-surface-2">
            {top.map((route) => (
              <li key={route.key} className="border-b hairline px-4 py-3 last:border-0">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[14px] text-ink-100">{route.label}</span>
                  <span className="tnum shrink-0 text-[15px] text-lode-300">{gbp(route.totalToSeller)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 text-[12px] text-ink-500">
                  <span>
                    {route.completionDaysMin}–{route.completionDaysMax} days
                    {best !== undefined && best.key === route.key && (
                      <span className="ml-2 text-lode-400">best fit</span>
                    )}
                  </span>
                  <span className="tnum">{route.certainty} certainty</span>
                </div>
              </li>
            ))}
          </ul>

          {/* capital stack — the funding structure, real */}
          <div className="rounded-xl border hairline bg-surface-2 px-4 py-3.5">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-500">Capital stack</span>
              <span className="text-[11px] text-ink-400">
                Originator cash <span className="tnum text-ink-200">{gbp(stack.originatorCash)}</span>
              </span>
            </div>
            <StackedBar segments={segments} />
          </div>

          <p className="text-[11px] leading-[1.5] text-ink-500">
            A worked example, not a live listing — every figure is computed by the engine at the
            moment you loaded this page; the property is an illustration. Each route also shows what
            the seller gives up, because the engine refuses a below-market route without it.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * A slim band under the hero: the free promise restated, and every audience
 * named with a door to walk through — so a visitor who is not a seller sees
 * themselves on the first screen rather than scrolling to find out. Free here is
 * "no upfront fees", which is true whether or not a success fee is chargeable,
 * so the line needs no permission check. Restrained on purpose — one line of
 * copy and a row of links, not a second hero.
 */
function AudienceBand() {
  const links = [
    { label: "Sellers", href: "/sell" },
    { label: "Buyers", href: "/appraise" },
    { label: "Lenders", href: "/partners#capital" },
    { label: "Agents", href: "/partners" },
    { label: "Conveyancers", href: "/partners#professionals" },
  ];
  return (
    <section className="border-b hairline bg-surface-1">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-6 py-4">
        <p className="text-[13px] leading-snug text-ink-300">
          <span className="font-medium text-ink-100">Free for sellers</span>
          <span className="text-ink-600"> — </span>
          no upfront fees, ever. One engine for every side of the deal.
        </p>
        <nav className="flex flex-wrap items-center gap-x-1 text-[13px]">
          {links.map((l, i) => (
            <span key={l.href} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden className="text-ink-700">·</span>}
              <Link
                href={l.href}
                className="rounded px-1.5 py-0.5 text-ink-400 transition-colors hover:text-lode-200"
              >
                {l.label}
              </Link>
            </span>
          ))}
        </nav>
      </div>
    </section>
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
      body: "Tell us the situation, not the asking price. You get costed routes — cash, deferred, JV or assisted sale — and exactly what each one leaves in your pocket. Free to see, free to decide, and no upfront fees, ever.",
      cta: "See my options — free",
      href: "/sell",
    },
    {
      tag: "Buy",
      title: "I appraise deals",
      body: "Paste any deal and get the true discount, the walk-away price and the stress that breaks it — free, no account. Then unlock verified off-market opportunities and negotiate through your agent.",
      cta: "Appraise a deal — free",
      href: "/appraise",
    },
    {
      tag: "Fund",
      title: "I have capital",
      body: "Post your lending criteria free and receive property-backed applications matched to them — underwritten, downside-modelled, regulatory route classified. Decisions, not leads.",
      cta: "How funding works",
      href: "/partners#capital",
    },
    {
      tag: "Agents",
      title: "I am an estate agent",
      body: "List the instructions you can't close, free, and receive buyers whose identity and funding we've already checked — never raw enquiries. You keep the client and the instruction.",
      cta: "How agents work with us",
      href: "/partners",
    },
    {
      tag: "Professionals",
      title: "I am a conveyancer or surveyor",
      body: "Join free. Receive work that is already transaction-ready, and pay only on a completed instruction — never for a lead.",
      cta: "Join the panel",
      href: "/partners#professionals",
    },
  ];

  return (
    <section className="border-b hairline bg-surface-1">
      {/*
        Six columns, not five. Five audiences across a 1280px page gives each
        one 256px, which is not enough for a sentence anybody would read. Three
        cards of two columns and two of three fills both rows evenly and keeps
        every body at a readable measure.
      */}
      <div className="mx-auto grid max-w-7xl gap-px overflow-hidden sm:grid-cols-2 lg:grid-cols-6">
        {doors.map((d, i) => (
          <Link
            key={d.tag}
            href={d.href}
            className={`group border-b border-r hairline px-6 py-8 transition-colors last:border-r-0 hover:bg-surface-2 ${
              i < 3 ? "lg:col-span-2" : "lg:col-span-3"
            }`}
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
function SupplySection({
  supply,
  promotion,
}: {
  supply: SupplyPosition;
  promotion: PromotionDecision;
}) {
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
              The three questions that matter before any analysis does — an appraisal engine with no
              supply behind it is just a spreadsheet with manners. Every number here is counted from
              the platform as this page loads, never typed by hand.
            </p>
            <p className="mt-4 max-w-[34rem] text-[14px] leading-[1.6] text-ink-400">
              {supply.summary}
            </p>

            {/*
              Where we are concentrating, and how the real coverage compares.
              A page that says "the West Midlands" while the pipeline is half in
              Leeds is a page whose first checkable claim is wrong, and a reader
              who catches one stops believing the figures that are true.
            */}
            <p className="mt-4 max-w-[34rem] border-l-2 border-lode-400/70 py-1 pl-4 text-[14px] leading-[1.6] text-ink-300">
              {focusCoverage(supply.areas).statement}
            </p>
            <ul className="mt-5 grid max-w-[34rem] gap-x-8 gap-y-2 sm:grid-cols-2">
              {LAUNCH_FOCUS.map((focus) => (
                <li key={focus} className="flex gap-2.5 text-[13px] leading-[1.6] text-ink-400">
                  <span className="mt-[0.5rem] h-1 w-1 shrink-0 rounded-full bg-lode-400" />
                  {focus}
                </li>
              ))}
            </ul>
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

            {/*
              This paragraph used to assert the platform's regulatory position
              in prose, on a page that then published a return four sections
              down. It is now read from the permission catalogue — the same
              answer the revenue model, the charge gate and the regulatory
              router get — so the page cannot state a position it does not hold.
            */}
            <p className="mt-4 text-[12px] leading-[1.6] text-ink-500">{promotion.reason}</p>
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
          lede={`Bought at ${gbp(a.costs.purchasePrice)}, worth ${gbp(a.exit.grossDevelopmentValue)} finished — that is not a ${gbp(naiveProfit)} profit. Lode charges every cost, then the tax, and only then scores the deal.`}
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
            <BigFigure label="Profit before tax" value={gbpSigned(a.profitBeforeTax)} muted />
            <BigFigure label={a.profitTaxLabel} value={`− ${gbp(a.profitTax)}`} muted />
            <BigFigure label="Profit after tax" value={gbpSigned(a.profit)} accent />
            <div className="grid grid-cols-2 gap-4">
              <MiniStat label="Headline discount" value={percent(a.discountToOmvBps)} />
              <MiniStat label="True discount" value={percent(a.trueDiscountBps)} hint="after every cost" />
              <MiniStat label="Margin on GDV" value={percent(a.marginOnGdvBps)} />
              <MiniStat label="Return on cash" value={percent(a.roiOnCashBps, 0)} />
            </div>
            {/*
              These are the illustration's own arithmetic, on a property named
              in the eyebrow as a worked example. What may not be published is a
              statement that opportunities are available at a given return —
              that is the supply statement above, and it consults
              `mayPublishReturns()` rather than asserting the position in prose.
            */}
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
          lede="Before any pack reaches a funder, nine fixed stresses hit it. The downside lands next to the headline, and every deal is shocked identically — so a lender can actually compare them."
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
          lede="Every pound is provided by someone who prices it. Lode assembles that stack around a viable deal and states plainly what the originator is really putting in."
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
          title={`One property. ${strategies.tested} strategies tested. Most rejected.`}
          lede="No property is forced into a house strategy. The rejections are the point: learn why cash purchase fails here but assisted sale clears, and you can use it on the next one."
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
          lede="Time on the market is weak evidence on its own. A year at one price is a stubborn seller; a year of cuts and relistings is someone trying and failing — a real problem to solve."
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
          title="Agreed is not completed. The OS drives the gap."
          lede="After terms are agreed, the win isn't a checklist — it's knowing which unfinished item sits on the critical path. Chase everything equally and you chase the wrong thing."
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

/**
 * What is checked, who is allowed through, and what happens when it is wrong.
 *
 * The page described the engine at length — the score, the stress tests, the
 * capital stack — and said nothing about the three things a buyer actually
 * weighs before paying: whether the property was checked before it was
 * marketed, whether the person they are competing with has money, and what
 * happens if the introduction turns out to be worthless. Those controls were
 * built and were invisible.
 *
 * Every list here is read from the module that enforces it. A guarantee
 * published in marketing and applied by support eventually differ, and the
 * difference is always in the platform's favour, which is how it becomes a
 * complaint to a redress scheme.
 */
function TrustSection() {
  const partA = MATERIAL_ITEMS.filter((i) => i.part === "A").length;
  const partBC = MATERIAL_ITEMS.length - partA;
  // The questions the Regulations require of a seller, read from the engine
  // with nothing recorded — which is the state every seller starts in.
  const sellerChecks = sellerDueDiligence(undefined, new Date()).checks;

  return (
    <section className="border-b hairline bg-surface-1">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <SectionHead
          eyebrow="What protects a buyer"
          title="Checked before it is listed. Graded before it reaches a seller. Refunded if it was wrong."
          lede="Three controls, in the order a buyer meets them — and each list below is read from the code that enforces it, so the promise and the practice cannot drift apart."
        />

        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          <div className="rounded-2xl border hairline bg-surface-2 px-6 py-7">
            <p className="text-sm font-medium text-ink-100">Before it is marketed</p>
            <p className="tnum mt-3 text-[28px] leading-none text-ink-100">{partA}</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-400">
              questions that must be answered on every property before it can be shown to anybody,
              with {partBC} more that apply according to tenure and jurisdiction. An unanswered one
              is published as unanswered, naming who was asked — a buyer cannot otherwise tell
              &ldquo;no covenants&rdquo; from &ldquo;nobody looked&rdquo;.
            </p>
            <ul className="mt-5 space-y-2 border-t hairline pt-5">
              {sellerChecks.map((check) => (
                <li key={check.label} className="flex gap-2 text-xs leading-relaxed text-ink-300">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-lode-400" />
                  <span>
                    {check.label}
                    {check.blocking && <span className="text-ink-500"> — blocks marketing</span>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[11px] leading-relaxed text-ink-500">
              Asked of the seller, not only of the buyer. The person on the telephone is very often
              not the registered proprietor.
            </p>
          </div>

          <div className="rounded-2xl border hairline bg-surface-2 px-6 py-7">
            <p className="text-sm font-medium text-ink-100">Before a buyer reaches a seller</p>
            <p className="mt-3 text-xs leading-relaxed text-ink-400">
              A motivated seller has finite patience and one property to sell. Spending it on
              somebody with no money is how the supply side dies, and the seller blames whoever
              introduced them.
            </p>
            <ul className="mt-5 space-y-3.5 border-t hairline pt-5">
              {GRADES.map((g) => (
                <li key={g.grade} className="flex gap-3">
                  <span
                    className={`tnum mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] ${
                      g.mayApproachSeller
                        ? "bg-emerald-400/10 text-emerald-300"
                        : "bg-ink-850 text-ink-500"
                    }`}
                  >
                    {g.grade}
                  </span>
                  <span className="text-xs leading-relaxed text-ink-300">
                    <span className="text-ink-100">{g.label}.</span> {g.meaning}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border hairline bg-surface-2 px-6 py-7">
            <p className="text-sm font-medium text-ink-100">If the introduction was wrong</p>
            <p className="mt-3 text-xs leading-relaxed text-ink-400">
              The reveal fee buys a verified pack and a controlled introduction. It never buys an
              address that is already on a portal.
            </p>
            <ul className="mt-5 space-y-2 border-t hairline pt-5">
              {REVEAL_GUARANTEE.map((line) => (
                <li key={line} className="flex gap-2 text-xs leading-relaxed text-ink-300">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-lode-400" />
                  {line}
                </li>
              ))}
            </ul>
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
            lede="Motivated-seller buying has one temptation: turn distress into discount. That path ends in complaints, void contracts and enforcement. So protection here isn't advice — a block stops the deal reaching capital at all."
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
          lede="Sellers enter free. The money comes from the dealmakers, capital and professionals that gather around the opportunity — and any stream whose permission isn't held shows as zero, never assumed."
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
                <tr key={l.stream} className={l.included ? "" : "opacity-45"}>
                  <td className="px-6 py-3.5 text-ink-200">
                    {l.label}
                    {!l.included && <span className="ml-2 text-xs text-ink-500">not yet active</span>}
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
          lede="Exclusive deal flow is the whole asset, so the supply side is free by design. Friction at acquisition is the one thing that would kill it — so there isn't any."
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

        {/*
          The subscription was the whole of this section, and the subscription
          is not how a buyer pays for a property. The reveal fee is the actual
          transaction and it was not stated anywhere a visitor could reach —
          a price somebody first meets at the checkout is a price they read as
          a surprise. Read from `pricing.ts`, which is the only place a price
          is allowed to exist.
        */}
        <div className="mt-5 overflow-hidden rounded-2xl border hairline bg-surface-2">
          <div className="border-b hairline px-6 py-5">
            <p className="text-sm font-medium text-ink-100">Then a fee per introduction</p>
            <p className="mt-2 max-w-[46rem] text-xs leading-relaxed text-ink-400">
              Paid once, when a buyer opens a specific opportunity — never to see an address that
              is already advertised. Priced by what the opportunity is, because the work behind a
              plot of land and the work behind a terraced house are not the same. The band is the
              floor and the ceiling; the middle figure is what is charged unless the opportunity is
              priced individually.
            </p>
          </div>
          <ul className="grid sm:grid-cols-2">
            {REVEAL_PRICES.map((r) => (
              <li
                key={r.opportunity}
                className="flex items-baseline justify-between gap-4 border-b hairline px-6 py-3 last:border-0 sm:odd:border-r"
              >
                <span className="text-[13px] text-ink-300">{r.label}</span>
                <span className="tnum shrink-0 text-[13px] text-ink-100">
                  {gbp(r.standard)}
                  <span className="text-ink-500">
                    {" "}
                    ({gbp(r.from)}–{gbp(r.to)})
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t hairline bg-surface-3 px-6 py-4">
            <p className="text-xs leading-relaxed text-ink-400">
              Refundable in full on any of the grounds listed above. Claims are made through the
              platform and the refund is automatic; nobody has to be persuaded.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}


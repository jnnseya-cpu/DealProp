import { notFound } from "next/navigation";
import { getDeal } from "@backend/store/repository";
import { coveredBuyBoxes } from "@backend/billing/mandates";
import { buildSellerRoutes, investorProfitOnRoute, type SellerRoute } from "@shared/domain/sellerRoutes";
import { assessSellerProtection } from "@shared/domain/protection";
import { referTradePartners } from "@shared/domain/partners";
import { scoreDeal } from "@shared/domain/dealScore";
import { countInterestedBuyers } from "@shared/domain/matching";
import { getJurisdiction, isDealReady } from "@shared/domain/jurisdictions";
import { gbp, percent } from "@shared/format";
import { SiteHeader, TradeReferrals } from "@/app/components/chrome";
import type { DealInputs, PropertyFacts, SellerProfile } from "@shared/domain/types";
import type { Money } from "@shared/money";

export const dynamic = "force-dynamic";

/**
 * Seller options page.
 *
 * Three rules this page follows, in order of importance:
 *
 *  1. Nothing shown here is inflated. The buyer count comes from live mandates
 *     whose hard criteria the property actually meets; if that is zero, the
 *     page says zero.
 *  2. The buyer's projected profit is displayed next to every offer. Consumer
 *     protection rules make it material information, and burying it is exactly
 *     the practice that gets this industry into trouble.
 *  3. If the Seller Protection Engine blocks, the seller sees a pause and a
 *     route to independent advice — not a set of offers with a warning beneath.
 */

export default async function SellerOptionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const record = await getDeal(id);
  if (record === undefined) notFound();

  const { property, seller } = record;
  const report = buildSellerRoutes(property, seller);
  const pack = getJurisdiction(property.jurisdiction);

  // Protection is assessed against the strongest available route, since that
  // is the one carrying the largest discount to open market value.
  const priceForAssessment = report.best?.totalToSeller ?? property.openMarketValue;
  const protection = assessSellerProtection({
    ...record.inputs,
    purchasePrice: priceForAssessment,
    structure: report.best?.structure ?? "cash-purchase",
  });

  const buyers = await countBuyers(record.inputs, priceForAssessment);

  return (
    <main className="min-h-screen">
      <SiteHeader
        width="max-w-4xl"
        trailing={<span className="font-mono text-xs text-ink-500">{record.reference}</span>}
      />

      <div className="mx-auto max-w-4xl px-6 py-14">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">
          Your options
        </span>
        <h1 className="mt-4 font-display text-4xl leading-tight text-ink-100 sm:text-5xl">
          {report.diagnostics.situationLabel}
          <span className="text-ink-500"> · </span>
          {property.locality}
        </h1>

        {!isDealReady(property.jurisdiction) && (
          <Callout tone="amber" title="We cannot give you figures for this nation yet">
            Our tax and cost tables for {pack.name} have not been verified. The routes below would
            not be reliable, so we are not showing figures. We will come back to you rather than
            give you a number we cannot stand behind.
          </Callout>
        )}

        {protection.blocked ? (
          <BlockedNotice reasons={protection.flags.filter((f) => f.severity === "block")} />
        ) : (
          <>
            <BuyerDemand buyers={buyers} />

            {report.noViableRoute ? (
              <Callout tone="amber" title="An ordinary sale is likely to serve you better">
                {report.summary} That is not a sales tactic — on these figures, a buyer of the kind
                we work with could not transact at a price you would accept. An estate agent is
                probably the right route, and we would rather tell you now.
              </Callout>
            ) : (
              <>
                <p className="mt-8 text-base leading-relaxed text-ink-400">{report.summary}</p>
                <MinimumCheck
                  minimum={seller.priceExpectation}
                  routes={report.routes}
                  best={report.best}
                />
                <div className="mt-10 space-y-5">
                  {report.routes.map((route, i) => (
                    <RouteCard
                      key={route.key}
                      route={route}
                      rank={i}
                      property={property}
                      seller={seller}
                    />
                  ))}
                </div>
              </>
            )}

            {report.unavailable.length > 0 && (
              <Unavailable routes={report.unavailable} />
            )}
          </>
        )}

        <Confidence property={property} />
        <TradeReferrals
          report={referTradePartners(property, seller)}
          heading="If you would rather do the work than sell"
          intro="Every figure above is lower than open market value because the property needs work and the buyer is pricing that risk. Doing the work yourself is a real alternative, and it is not one we lose by telling you about. These are the people we would use."
        />
        <Disclosures items={protection.requiredDisclosures} />
        {protection.flags.filter((f) => f.severity === "caution").length > 0 && (
          <Safeguards flags={protection.flags.filter((f) => f.severity === "caution")} />
        )}
        <Obligations pack={pack} />
      </div>
    </main>
  );
}

async function countBuyers(
  inputs: DealInputs,
  price: Money,
): Promise<{ total: number; fast: number }> {
  // Covered mandates only. A mandate past what its owner's plan includes is
  // not demand anybody is currently paying to hold, and this number is shown to
  // a seller deciding whether to sell their home.
  const boxes = await coveredBuyBoxes();
  if (boxes.length === 0) return { total: 0, fast: 0 };
  // Scored at the best available route's price, using a conventional funded
  // purchase, because that is the shape most Buy Boxes are written against.
  const scored = scoreDeal({
    ...inputs,
    purchasePrice: price,
    structure: "cash-purchase",
    exit: "sell",
  });
  return countInterestedBuyers(boxes, scored);
}


function BuyerDemand({ buyers }: { buyers: { total: number; fast: number } }) {
  if (buyers.total === 0) {
    return (
      <Callout tone="neutral" title="No buyer currently has a mandate matching this property">
        We will not invent a number here. None of the buyers registered with us are currently
        looking for a property like yours at a price that works. That can change, and the routes
        below still stand on their own.
      </Callout>
    );
  }

  return (
    <div className="mt-8 rounded-2xl border border-lode-500/30 bg-lode-400/5 px-6 py-5">
      <p className="text-lg text-ink-100">
        <span className="font-display text-3xl text-lode-200">{buyers.total}</span>{" "}
        verified {buyers.total === 1 ? "buyer is" : "buyers are"} currently looking for a property
        like yours.
      </p>
      {buyers.fast > 0 && (
        <p className="mt-2 text-sm text-ink-300">
          {buyers.fast} of {buyers.total === 1 ? "them" : "those"} can complete within 28 days,
          subject to due diligence.
        </p>
      )}
      <p className="mt-3 text-xs text-ink-400">
        These are live buying mandates that your property meets on every hard criterion. It is not a
        count of everyone registered.
      </p>
    </div>
  );
}

const CERTAINTY_COPY: Record<SellerRoute["certainty"], { label: string; tone: string }> = {
  high: { label: "High certainty", tone: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" },
  medium: { label: "Medium certainty", tone: "text-amber-300 border-amber-500/30 bg-amber-500/10" },
  conditional: { label: "Conditional", tone: "text-orange-300 border-orange-500/30 bg-orange-500/10" },
};

function RouteCard({
  route,
  rank,
  property,
  seller,
}: {
  route: SellerRoute;
  rank: number;
  property: PropertyFacts;
  seller: SellerProfile;
}) {
  const certainty = CERTAINTY_COPY[route.certainty];
  const investorProfit = investorProfitOnRoute(property, seller, route);
  const letter = String.fromCharCode(65 + rank);

  return (
    <section
      className={`overflow-hidden rounded-2xl border ${rank === 0 ? "border-lode-500/40 bg-lode-400/5" : "hairline bg-ink-900/40"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b hairline px-6 py-5">
        <div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-ink-500">OPTION {letter}</span>
            {rank === 0 && (
              <span className="rounded-full border border-lode-500/40 bg-lode-400/10 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.1em] text-lode-200">
                Best fit for what you told us
              </span>
            )}
          </div>
          <h2 className="mt-2 font-display text-2xl text-ink-100">{route.label}</h2>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs ${certainty.tone}`}>
          {certainty.label}
        </span>
      </div>

      <div className="grid gap-6 px-6 py-6 sm:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-ink-400">You receive</p>
          <p className="tnum mt-1 font-display text-4xl text-ink-100">{gbp(route.totalToSeller)}</p>

          {route.deferred > 0 && (
            <dl className="mt-4 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-400">On completion</dt>
                <dd className="tnum text-ink-100">{gbp(route.upfront)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-400">
                  Later{route.deferredOverMonths !== undefined ? `, over ${route.deferredOverMonths} months` : ""}
                </dt>
                <dd className="tnum text-ink-100">{gbp(route.deferred)}</dd>
              </div>
            </dl>
          )}

          <p className="mt-4 text-sm text-ink-300">
            Completion in {route.completionDaysMin}–{route.completionDaysMax} days
          </p>
          <p className="mt-4 text-sm leading-relaxed text-ink-300">{route.summary}</p>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-ink-400">What you give up</p>
          <ul className="mt-2 space-y-2">
            {route.tradeOffs.map((t) => (
              <li key={t} className="flex gap-2.5 text-xs leading-relaxed text-ink-300">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-400" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t hairline bg-ink-950/40 px-6 py-4">
        <p className="text-xs text-ink-400">
          A buyer would expect to make roughly{" "}
          <span className="tnum text-ink-200">{gbp(investorProfit)}</span> on this, before their own
          tax. We show you this because you are entitled to know it.
        </p>
        {route.fidelity === "indicative" && (
          <span className="rounded-full border hairline px-2.5 py-1 text-[10px] uppercase tracking-[0.1em] text-ink-400">
            Indicative figures
          </span>
        )}
      </div>

      {route.requires.length > 0 && (
        <div className="border-t hairline px-6 py-4">
          <p className="text-[11px] uppercase tracking-[0.12em] text-ink-400">
            Before this can go ahead
          </p>
          <ul className="mt-2 space-y-1.5">
            {route.requires.map((r) => (
              <li key={r} className="flex gap-2.5 text-xs leading-relaxed text-ink-300">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lode-400" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * The seller's stated minimum, checked against what is actually on offer.
 *
 * A seller who told us their floor should not have to scan four figures to
 * work out that none of them reaches it, or that the only one that does is the
 * slowest. Saying it plainly is the difference between a tool that informs and
 * one that hopes the seller anchors downward without noticing.
 */
function MinimumCheck({
  minimum,
  routes,
  best,
}: {
  minimum?: Money;
  routes: readonly SellerRoute[];
  best?: SellerRoute;
}) {
  if (minimum === undefined || routes.length === 0) return null;

  const meeting = routes.filter((r) => r.totalToSeller >= minimum);
  const highest = [...routes].sort((a, b) => b.totalToSeller - a.totalToSeller)[0];

  if (meeting.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-amber-500/25 bg-amber-500/5 px-6 py-5">
        <p className="text-base text-ink-100">
          You told us you need at least {gbp(minimum)}. None of these routes reach that.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-400">
          The closest is {highest?.label.toLowerCase()} at {gbp(highest?.totalToSeller ?? minimum)}.
          If that figure does not work for you, an ordinary sale through an estate agent is likely to
          be the better route, and we would rather say so than talk you down.
        </p>
      </div>
    );
  }

  const meetsBest = best !== undefined && best.totalToSeller >= minimum;
  const alternative = meeting[0];

  return (
    <div className="mt-8 rounded-2xl border border-lode-500/30 bg-lode-400/5 px-6 py-5">
      <p className="text-base text-ink-100">
        You told us you need at least {gbp(minimum)}.{" "}
        {meeting.length === 1 ? "One route reaches that" : `${meeting.length} routes reach that`}.
      </p>
      {!meetsBest && alternative !== undefined && (
        <p className="mt-2 text-sm leading-relaxed text-ink-400">
          It is not the one we have ranked first. {alternative.label} pays{" "}
          {gbp(alternative.totalToSeller)}, but completes in {alternative.completionDaysMin}–
          {alternative.completionDaysMax} days rather than {best?.completionDaysMin}–
          {best?.completionDaysMax}. We have ranked on the priorities you gave us, not on price — if
          the amount matters more than the timing, {alternative.label.toLowerCase()} is the one to
          look at.
        </p>
      )}
    </div>
  );
}

function Unavailable({ routes }: { routes: readonly SellerRoute[] }) {
  return (
    <div className="mt-10 rounded-2xl border hairline bg-ink-900/30 px-6 py-5">
      <p className="text-[11px] uppercase tracking-[0.12em] text-ink-400">
        Routes we considered and ruled out
      </p>
      <ul className="mt-3 space-y-2.5">
        {routes.map((r) => (
          <li key={r.key} className="text-sm text-ink-300">
            <span className="text-ink-100">{r.label}</span>
            <span className="text-ink-500"> — </span>
            {r.unavailableReason ?? "Not available for this property."}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BlockedNotice({
  reasons,
}: {
  reasons: readonly { key: string; label: string; detail: string; remedy: string }[];
}) {
  return (
    <div className="mt-8 rounded-2xl border border-red-500/30 bg-red-500/5 px-7 py-7">
      <h2 className="font-display text-2xl text-red-200">
        We have paused this and a person will review it
      </h2>
      <p className="mt-4 text-sm leading-relaxed text-ink-200">
        We are not showing you figures yet. Based on what you told us, this needs a human to look at
        it before anyone makes you an offer — that protects you, and we would rather slow down than
        get this wrong.
      </p>
      <ul className="mt-6 space-y-4">
        {reasons.map((r) => (
          <li key={r.key}>
            <p className="text-sm text-ink-100">{r.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-400">{r.detail}</p>
            <p className="mt-1 text-xs leading-relaxed text-lode-300">{r.remedy}</p>
          </li>
        ))}
      </ul>
      <p className="mt-6 border-t border-red-500/20 pt-5 text-xs leading-relaxed text-ink-400">
        In the meantime: you do not have to do anything, and you should not sign anything. If money
        is the pressure, free and independent debt advice is available from Citizens Advice and
        StepChange. If you are facing repossession, speak to your lender and to a solicitor before
        agreeing to any sale.
      </p>
    </div>
  );
}

function Confidence({ property }: { property: PropertyFacts }) {
  return (
    <section className="mt-14 rounded-2xl border hairline bg-ink-900/40 px-6 py-6">
      <p className="text-[11px] uppercase tracking-[0.12em] text-ink-400">
        How confident we are in these figures
      </p>
      <div className="mt-4 flex flex-wrap items-baseline gap-8">
        <div>
          <p className="tnum font-display text-3xl text-ink-100">
            {percent(property.valuationConfidence, 0)}
          </p>
          <p className="mt-1 text-xs text-ink-400">confidence in the value</p>
        </div>
        <div>
          <p className="tnum font-display text-3xl text-ink-100">{gbp(property.openMarketValue)}</p>
          <p className="mt-1 text-xs text-ink-400">value we have used</p>
        </div>
        <div>
          <p className="tnum font-display text-3xl text-ink-100">
            {gbp(property.refurbishmentEstimate)}
          </p>
          <p className="mt-1 text-xs text-ink-400">works we have assumed</p>
        </div>
      </div>
      <p className="mt-5 text-xs leading-relaxed text-ink-400">
        We have not valued your property or inspected it. These figures come from what you told us
        and from general assumptions about condition. Every number above will move once a valuation
        and a builder&apos;s estimate exist, and any offer made to you would be subject to both.
      </p>
    </section>
  );
}

function Disclosures({ items }: { items: readonly string[] }) {
  return (
    <section className="mt-6 rounded-2xl border hairline bg-ink-900/40 px-6 py-6">
      <p className="text-[11px] uppercase tracking-[0.12em] text-ink-400">
        Things you are entitled to know
      </p>
      <ul className="mt-3 space-y-2.5">
        {items.map((d) => (
          <li key={d} className="flex gap-2.5 text-sm leading-relaxed text-ink-300">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-lode-400" />
            {d}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Safeguards({
  flags,
}: {
  flags: readonly { key: string; label: string; remedy: string }[];
}) {
  return (
    <section className="mt-6 rounded-2xl border border-amber-500/25 bg-amber-500/5 px-6 py-6">
      <p className="text-[11px] uppercase tracking-[0.12em] text-amber-300/80">
        Safeguards we will put in place
      </p>
      <ul className="mt-3 space-y-3">
        {flags.map((f) => (
          <li key={f.key}>
            <p className="text-sm text-ink-100">{f.label}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-400">{f.remedy}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Obligations({ pack }: { pack: ReturnType<typeof getJurisdiction> }) {
  return (
    <footer className="mt-10 border-t hairline pt-8">
      <p className="text-xs leading-relaxed text-ink-500">
        Figures are estimates for discussion, not offers, and not financial or legal advice. Tax
        figures require confirmation by a qualified adviser. You are entitled to independent legal
        advice before agreeing anything, and to sell on the open market instead. Operating in{" "}
        {pack.name} engages {pack.obligations.length} regulatory obligations, including{" "}
        {pack.obligations
          .slice(0, 2)
          .map((o) => o.label.toLowerCase())
          .join(" and ")}
        .
      </p>
    </footer>
  );
}

function Callout({
  tone,
  title,
  children,
}: {
  tone: "amber" | "neutral";
  title: string;
  children: React.ReactNode;
}) {
  const tones = {
    amber: "border-amber-500/25 bg-amber-500/5",
    neutral: "hairline bg-ink-900/40",
  };
  return (
    <div className={`mt-8 rounded-2xl border px-6 py-5 ${tones[tone]}`}>
      <p className="text-base text-ink-100">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-400">{children}</p>
    </div>
  );
}

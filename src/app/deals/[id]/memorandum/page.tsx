import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { audit } from "@backend/audit";
import { meter } from "@backend/billing/meter";
import { getDeal } from "@backend/store/repository";
import { runDealDirector } from "@shared/domain/director";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { buildCloseReport } from "@shared/domain/completion";
import { referTradePartners } from "@shared/domain/partners";
import { getJurisdiction } from "@shared/domain/jurisdictions";
import { STRUCTURE_LABELS } from "@shared/domain/strategies";
import { add } from "@shared/money";
import { gbp, gbpSigned, months, percent } from "@shared/format";
import { VERDICT_TONE } from "@/app/components/chrome";
import "./memorandum.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Investment memorandum — Lode",
};

/**
 * Investment memorandum.
 *
 * A print view of the same `DirectorBriefing` the Deal Room renders, so the
 * document and the screen cannot disagree — the single-source rule matters more
 * here than anywhere else, because this is the artefact that leaves the
 * building.
 *
 * Two things it does that the Deal Room does not:
 *
 *  1. **It prints.** Light, A4, one column, with the page furniture suppressed.
 *     A dark screen design printed on paper is unreadable and wastes toner.
 *  2. **It carries the promotion notice.** A deal pack sent to a private
 *     investor is a financial promotion under FSMA s.21, and the platform is
 *     not authorised. The notice is at the top, not in a footer, because its
 *     purpose is to be read before the figures are.
 *
 * It is also the one page where the product itself leaves permanently, so it is
 * metered. A plan that lists twenty memoranda and counts none of them sells one
 * month of the cheapest plan including them in exchange for the whole library —
 * after which the customer cancels and the value never comes back. Reopening a
 * memorandum already taken this period is free; going past what the plan
 * includes charges the prepaid balance rather than refusing, because refusing
 * caps revenue at the plan price and turns the best customers away.
 */
export default async function MemorandumPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Deal material, not merely seller data: this is the artefact that leaves
  // the building, so an external viewer needs a current certification.
  const viewer = await requirePermission("view-deal-material", `/deals/${id}/memorandum`);
  const record = await getDeal(id);
  if (record === undefined) notFound();

  // Metered before anything is rendered. Checking after the figures are on the
  // page would be a paywall the reader has already walked through.
  const charge = await meter(viewerAccount(viewer), "memorandum-export", record.id);
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
    detail: `${record.reference} (${charge.outcome})`,
  });

  const working = toWorkingDeal(record.inputs);
  const briefing = runDealDirector(working.inputs);
  const close = record.milestones !== undefined ? buildCloseReport(record.milestones) : undefined;
  const partners = referTradePartners(record.property, record.seller);
  const pack = getJurisdiction(record.property.jurisdiction);
  const a = briefing.scored.appraisal;
  const p = record.property;
  const verdict = VERDICT_TONE[briefing.verdict];

  return (
    <main className="memo">
      <nav className="memo-actions" aria-label="Document actions">
        <Link href={`/deals/${record.id}`}>&larr; Back to the Deal Room</Link>
        <span>Use your browser&rsquo;s print dialogue to save this as a PDF.</span>
      </nav>

      <article>
        <header className="memo-head">
          <p className="memo-kicker">Lode &middot; Investment memorandum</p>
          <h1>
            {p.locality}, {p.postcodeArea}
          </h1>
          <p className="memo-sub">
            {p.bedrooms}-bed {p.propertyType}, {p.tenure} &middot; {record.reference} &middot;
            prepared {new Date().toLocaleDateString("en-GB")}
          </p>
        </header>

        {/* The notice sits above the figures deliberately. */}
        <section className="memo-notice">
          <h2>Status of this document</h2>
          <p>
            This is a screening analysis prepared from information supplied by the seller and from
            engine assumptions. It is <strong>not advice</strong>, not a valuation, and not an offer.
          </p>
          <p>
            It is <strong>not approved as a financial promotion</strong>. An invitation or
            inducement to engage in investment activity must be made or approved by a person
            authorised under FSMA, and Lode is not authorised. This document must not be
            distributed to a private investor who has not been categorised as high net worth,
            sophisticated or professional.
          </p>
          <p>
            Every tax figure requires professional review. Rate tables are dated snapshots
            ({pack.name}, as of {pack.asOf}) and go stale.
          </p>
        </section>

        <section>
          <h2>Position</h2>
          <p className="memo-verdict">
            <strong>{verdict.label}</strong> &middot; Deal Score{" "}
            {briefing.scored.breakdown.composite}/100
          </p>
          <p>{briefing.headline}</p>
          <ul>
            {briefing.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>

        {briefing.scored.protection.blocked && (
          <section className="memo-block">
            <h2>This deal is blocked</h2>
            <p>
              The Seller Protection Engine has stopped this transaction. It is reproduced here for
              completeness and must not be presented to capital as an opportunity.
            </p>
            <ul>
              {briefing.scored.protection.flags
                .filter((f) => f.severity === "block")
                .map((f) => (
                  <li key={f.key}>
                    <strong>{f.label}.</strong> {f.remedy}
                  </li>
                ))}
            </ul>
          </section>
        )}

        <section>
          <h2>The property</h2>
          <table>
            <tbody>
              <Row k="Open market value" v={gbp(p.openMarketValue)} />
              <Row k="Valuation confidence" v={percent(p.valuationConfidence, 0)} />
              <Row k="Refurbishment estimate" v={gbp(p.refurbishmentEstimate)} />
              <Row k="Value after works" v={gbp(p.postWorksValue)} />
              <Row k="Achievable rent" v={`${gbp(p.monthlyRent)} per month`} />
              <Row k="Occupancy" v={p.occupancy} />
              {p.leaseYearsRemaining !== undefined && (
                <Row k="Unexpired lease" v={`${p.leaseYearsRemaining} years`} />
              )}
              <Row
                k="Known issues"
                v={p.knownIssues.length > 0 ? p.knownIssues.join(", ") : "None disclosed"}
              />
            </tbody>
          </table>
        </section>

        <section>
          <h2>The model</h2>
          <p>
            Structure: {STRUCTURE_LABELS[working.inputs.structure]} &middot; hold{" "}
            {months(working.inputs.holdMonths)} &middot; exit {working.inputs.exit}.
            {working.modelled && ` ${working.note ?? "No price has been agreed; these figures use a derived price."}`}
          </p>
          <table>
            <tbody>
              <Row k="Purchase price" v={gbp(working.inputs.purchasePrice)} />
              <Row k="Transfer tax" v={gbp(a.costs.transferTax)} />
              <Row k="Refurbishment" v={gbp(a.costs.refurbishment)} />
              <Row
                k="Finance costs"
                v={gbp(
                  add(
                    a.costs.financeArrangement,
                    a.costs.financeInterest,
                    a.costs.financeExit,
                    a.costs.lenderCosts,
                  ),
                )}
              />
              <Row
                k="Professional, holding and selling"
                v={gbp(
                  add(
                    a.costs.buyerLegal,
                    a.costs.survey,
                    a.costs.holdingCosts,
                    a.costs.sellingCosts,
                    a.costs.contingency,
                  ),
                )}
              />
              <Row k="Total deployed" v={gbp(a.effectiveBasis)} strong />
              <Row k="Gross development value" v={gbp(a.exit.grossDevelopmentValue)} />
              <Row k="Profit before tax" v={gbpSigned(a.profitBeforeTax)} />
              <Row k="Profit tax" v={gbp(a.profitTax)} />
              <Row k="Profit after tax" v={gbpSigned(a.profit)} strong />
              <Row k="Margin on GDV" v={percent(a.marginOnGdvBps, 1)} />
              <Row k="True discount to value" v={percent(a.trueDiscountBps, 1)} />
            </tbody>
          </table>
          <p className="memo-note">
            The Deal Score is computed on profit <em>after</em> tax. True discount is total money
            deployed measured against open market value, which is why it can be negative on a
            property bought visibly &ldquo;below market&rdquo;.
          </p>
        </section>

        <section>
          <h2>Capital</h2>
          {briefing.stack.feasible ? (
            <table>
              <tbody>
                {briefing.stack.layers.map((l) => (
                  <Row key={l.label} k={l.label} v={gbp(l.amount)} />
                ))}
                <Row k="Originator cash required" v={gbp(briefing.stack.originatorCash)} strong />
              </tbody>
            </table>
          ) : (
            <p>
              No capital stack closes on these figures. {briefing.stack.warnings.join(" ")}
            </p>
          )}
          <p>
            Capital recycling: {gbp(briefing.recycle.released)} released of{" "}
            {gbp(briefing.recycle.deployed)} deployed, {gbp(briefing.recycle.leftIn)} left in
            &mdash; {percent(briefing.recycle.recycledBps, 0)} recycled.{" "}
            {briefing.recycle.verdict}
          </p>
        </section>

        <section>
          <h2>Stress testing</h2>
          <p>
            Nine scenarios. Single-factor stresses move one variable and a loss in one means the
            deal depends on a single assumption holding; compound scenarios stack several severe
            moves and the harshest is built to be nearly unpassable.
          </p>
          <table>
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Tier</th>
                <th className="num">Profit after tax</th>
              </tr>
            </thead>
            <tbody>
              {briefing.scored.redTeam.results.map((r) => (
                <tr key={r.stress.key}>
                  <td>{r.stress.label}</td>
                  <td>{r.stress.tier}</td>
                  <td className="num">{gbpSigned(r.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="memo-note">
            Resilience {briefing.scored.redTeam.resilience}/100 &middot;{" "}
            {briefing.scored.redTeam.singleFactorLosses.length} single-factor{" "}
            {briefing.scored.redTeam.singleFactorLosses.length === 1 ? "loss" : "losses"} &middot;{" "}
            {briefing.scored.redTeam.compoundLosses.length} compound &middot; worst case{" "}
            {gbpSigned(briefing.scored.redTeam.worstCase)}.
          </p>
        </section>

        {close !== undefined && (
          <section>
            <h2>Execution</h2>
            <p>
              Close Score {close.closeScore}% &middot; completion probability{" "}
              {close.completionProbability}% &middot; critical path {close.criticalPathDays} days.
            </p>
            {close.blockers.length > 0 && (
              <ul>
                {close.blockers.slice(0, 6).map((b) => (
                  <li key={b.milestone.key}>
                    <strong>{b.message}</strong> {b.action}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {partners.referrals.length > 0 && (
          <section>
            <h2>Works</h2>
            <ul>
              {partners.referrals.map(({ partner, reasons, disclosure }) => (
                <li key={partner.key}>
                  <strong>
                    {partner.name} &mdash; {partner.remit}.
                  </strong>{" "}
                  {reasons.join(" ")} <em>{disclosure}</em>
                </li>
              ))}
            </ul>
          </section>
        )}

        {briefing.gatingActions.length > 0 && (
          <section>
            <h2>Before this may be shown to capital</h2>
            <ul>
              {briefing.gatingActions.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2>Regulatory obligations engaged</h2>
          <ul>
            {briefing.obligations.map((o) => (
              <li key={o.key}>
                <strong>{o.label}.</strong> {o.detail}{" "}
                <span className="memo-ref">{o.authority}</span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="memo-foot">
          <p>
            Prepared by Lode from the engine that produced the Deal Score. Figures are screening
            estimates, not advice, and every tax figure requires professional review.
          </p>
        </footer>
      </article>
    </main>
  );
}

function Row({ k, v, strong = false }: { k: string; v: string; strong?: boolean }) {
  return (
    <tr className={strong ? "strong" : undefined}>
      <th scope="row">{k}</th>
      <td className="num">{v}</td>
    </tr>
  );
}

/**
 * Shown where the plan's memoranda are used up and the balance cannot cover
 * another.
 *
 * Deliberately explicit about which of the two ran out and what it would cost,
 * because "upgrade to continue" with no figure is the pattern that makes people
 * assume they are being squeezed rather than metered.
 */
function OutOfAllowance({ reason, dealId }: { reason: string; dealId: string }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <span className="eyebrow">
        Memorandum
      </span>
      <h1 className="mt-2.5 font-display text-[28px] leading-[1.15] text-ink-100">
        Not available on your plan right now
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-ink-300">{reason}</p>
      <p className="mt-6 text-sm leading-relaxed text-ink-400">
        Memoranda you have already opened this period stay open at no further cost.
      </p>
      <div className="mt-8 flex gap-4">
        <Link
          href={`/deals/${dealId}`}
          className="inline-flex h-9.5 items-center justify-center gap-2 rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-100 transition-colors hover:border-ink-600 hover:bg-surface-3"
        >
          Back to the Deal Room
        </Link>
      </div>
    </main>
  );
}

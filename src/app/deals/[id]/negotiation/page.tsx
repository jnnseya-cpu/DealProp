import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/app/components/chrome";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { audit } from "@backend/audit";
import { getDeal } from "@backend/store/repository";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { contextFor, negotiationBand } from "@shared/domain/negotiation";
import { gbp, percent } from "@shared/format";
import { ZERO } from "@shared/money";

export const dynamic = "force-dynamic";

export const metadata = { title: "Negotiation — Lode" };

/**
 * The negotiating position for one deal.
 *
 * The hard part of a negotiation is not the words, it is knowing the highest
 * price at which the deal still works and then not going past it. That number
 * is computed here from the same engine that scores the deal, so it cannot
 * drift during a conversation — which is how margin is actually lost, one
 * reasonable-looking concession at a time.
 *
 * What this page does not do is write the approach. What to say is a person's
 * job. What the numbers are is not.
 */
/**
 * The completion window a cash purchase is offered on.
 *
 * Stated rather than derived, because it is what the seller is being paid for
 * and it has to be a promise somebody intends to keep.
 */
const COMPLETION_DAYS = 21;

const TONE: Record<string, string> = {
  opening: "text-lode-200",
  target: "text-ink-100",
  "walk-away": "text-amber-300",
  floor: "text-red-300",
};

export default async function NegotiationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requirePermission("view-seller-data", `/deals/${id}/negotiation`);
  const record = await getDeal(id);
  if (record === undefined) notFound();

  await audit("viewed-seller-data", {
    ...(viewerAccount(viewer) !== undefined ? { account: viewerAccount(viewer) } : {}),
    subject: record.id,
    detail: `${record.reference} (negotiation)`,
  });

  const inputs = toWorkingDeal(record.inputs).inputs;
  const band = negotiationBand(inputs);
  const market = inputs.property.openMarketValue;

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href={`/deals/${record.id}`} className="transition hover:text-ink-100">Deal Room</Link>
            <Link href={`/deals/${record.id}/funding`} className="transition hover:text-ink-100">Funding</Link>
            <Link href={`/deals/${record.id}/agents`} className="transition hover:text-ink-100">Agents</Link>
          </nav>
        }
      />

      <div className="mx-auto max-w-3xl px-6 py-14">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">
          Negotiation · {record.reference}
        </span>

        {band.blocked ? (
          <>
            <h1 className="mt-4 font-display text-4xl leading-tight text-red-300">
              No position
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-200">{band.summary}</p>
            {band.blockedReason !== undefined && (
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-400">
                {band.blockedReason}
              </p>
            )}
          </>
        ) : (
          <>
            <h1
              className={`mt-4 font-display text-4xl leading-tight ${
                band.outbidByAlternative ? "text-amber-300" : "text-ink-100"
              }`}
            >
              {band.outbidByAlternative
                ? "They can do better elsewhere"
                : `Stop at ${gbp(band.walkAway?.price ?? ZERO)}`}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">{band.summary}</p>

            <section className="mt-10 rounded-2xl border hairline bg-ink-900/40 px-6 py-6">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">
                The band
              </h2>
              <ul className="mt-4 space-y-4">
                {band.positions.map((position) => (
                  <li key={position.kind}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-6">
                      <p className={`text-sm ${TONE[position.kind] ?? "text-ink-200"}`}>
                        {position.kind.replace("-", " ")}
                      </p>
                      <p className="font-mono text-sm text-ink-100">
                        {gbp(position.price)}
                        <span className="text-ink-600"> · </span>
                        <span className="text-ink-400">{percent(position.marginBps)} margin</span>
                      </p>
                    </div>
                    <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-500">
                      {position.reason}
                    </p>
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-6 rounded-2xl border hairline bg-ink-900/40 px-6 py-6">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">
                What the seller must be told
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-ink-200">
                {contextFor(band.opening?.price ?? ZERO, market, COMPLETION_DAYS).sentence}
              </p>
              <p className="mt-4 text-xs leading-relaxed text-ink-500">
                An offer below market value is only defensible if the seller can see what they are
                being paid for and decide for themselves whether it is worth the difference. This
                goes with the offer, not after it.
              </p>
            </section>
          </>
        )}

        <section className="mt-6 rounded-2xl border hairline bg-ink-900/40 px-6 py-6">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">
            What the seller could take instead
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-400">{band.alternatives.summary}</p>
          <ul className="mt-4 space-y-3">
            {band.alternatives.routes.slice(0, 4).map((route) => (
              <li key={route.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-6">
                  <p className="text-sm text-ink-200">{route.label}</p>
                  <p className="font-mono text-xs text-ink-300">
                    {gbp(route.totalToSeller)}
                    <span className="text-ink-600"> · </span>
                    {route.completionDaysMin}–{route.completionDaysMax} days
                  </p>
                </div>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-500">{route.summary}</p>
              </li>
            ))}
          </ul>
        </section>

        {band.disclosures.length > 0 && (
          <section className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-6 py-6">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-300">
              Disclosures required before the seller can accept
            </h2>
            <ul className="mt-3 space-y-2">
              {band.disclosures.map((disclosure) => (
                <li key={disclosure} className="text-sm leading-relaxed text-amber-200">
                  {disclosure}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

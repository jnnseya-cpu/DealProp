import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/app/components/chrome";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { audit } from "@backend/audit";
import { getDeal } from "@backend/store/repository";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { contextFor, negotiationBand, respondTo } from "@shared/domain/negotiation";
import { gbp, percent } from "@shared/format";
import { fromMajor, ZERO, type Money } from "@shared/money";

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

/** Whole pounds from the query string to Money, or undefined if not a price. */
function toMoney(raw: string | undefined): Money | undefined {
  if (raw === undefined) return undefined;
  const pounds = Number(raw.replace(/[£,\s]/g, ""));
  return Number.isFinite(pounds) && pounds > 0 ? fromMajor(pounds) : undefined;
}

export default async function NegotiationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const viewer = await requirePermission("view-seller-data", `/deals/${id}/negotiation`);
  const record = await getDeal(id);
  if (record === undefined) notFound();

  const query = await searchParams;
  const one = (key: string): string | undefined => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };

  await audit("viewed-seller-data", {
    ...(viewerAccount(viewer) !== undefined ? { account: viewerAccount(viewer) } : {}),
    subject: record.id,
    detail: `${record.reference} (negotiation)`,
  });

  const inputs = toWorkingDeal(record.inputs).inputs;
  const band = negotiationBand(inputs);
  const market = inputs.property.openMarketValue;

  // The renegotiation move for a number the seller has named. The baseline
  // "current offer" is our opening position; respondTo never counters past the
  // walk-away ceiling, which is the whole point of computing it rather than
  // deciding it in the moment.
  const baselineOffer = band.opening?.price;
  const sellerAsking = toMoney(one("sellerAsking"));
  const currentOffer = toMoney(one("currentOffer")) ?? baselineOffer;
  const response =
    !band.blocked && sellerAsking !== undefined && currentOffer !== undefined
      ? respondTo(band, sellerAsking, currentOffer)
      : undefined;

  const MOVE_TONE: Record<string, string> = {
    accept: "text-emerald-300",
    counter: "text-lode-300",
    hold: "text-ink-200",
    "walk-away": "text-red-300",
  };

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

      <div className="mx-auto max-w-3xl px-6 py-10">
        <span className="eyebrow">
          Negotiation · {record.reference}
        </span>

        {band.blocked ? (
          <>
            <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-red-300 sm:text-[32px] sm:leading-[1.12]">
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

            <section className="mt-10 rounded-2xl border hairline bg-surface-1 px-5 py-4">
              <h2 className="eyebrow">
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

            <section className="mt-6 rounded-2xl border hairline bg-surface-1 px-5 py-4">
              <h2 className="eyebrow">
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

            <section className="mt-6 rounded-2xl border hairline bg-surface-1 px-5 py-4">
              <h2 className="eyebrow">Respond to a number</h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-400">
                Enter what the seller is asking. The move is computed against the{" "}
                {gbp(band.walkAway?.price ?? ZERO)} ceiling — it never counters past the point where
                the deal stops working, which is how margin is lost one concession at a time.
              </p>
              {/* Stateless, like the free appraisal: the number lives in the address
                  bar, nothing is written, and a GET re-renders the move. */}
              <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="sellerAsking" className="block text-xs text-ink-500">
                    Seller is asking
                  </label>
                  <input
                    id="sellerAsking"
                    name="sellerAsking"
                    inputMode="numeric"
                    defaultValue={one("sellerAsking") ?? ""}
                    placeholder="£195,000"
                    className="mt-1.5 h-10 w-44 rounded-md border hairline bg-ink-950 px-3 text-sm text-ink-100"
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex h-10 items-center rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-100 transition-colors hover:border-ink-600 hover:bg-surface-3"
                >
                  What do we do?
                </button>
              </form>

              {response !== undefined && (
                <div className="mt-5 border-l-2 border-ink-700 pl-4">
                  <p className={`font-display text-xl ${MOVE_TONE[response.move] ?? "text-ink-100"}`}>
                    {response.move === "counter" && response.counterAt !== undefined
                      ? `Counter at ${gbp(response.counterAt)}`
                      : response.move === "accept"
                        ? "Accept"
                        : response.move === "walk-away"
                          ? "Walk away"
                          : "Hold"}
                  </p>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-300">{response.reason}</p>
                </div>
              )}
            </section>
          </>
        )}

        <section className="mt-6 rounded-2xl border hairline bg-surface-1 px-5 py-4">
          <h2 className="eyebrow">
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
          <section className="mt-6 rounded-lg border-l-2 border-amber-500/80 bg-surface-1 px-5 py-4">
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

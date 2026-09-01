import Link from "next/link";
import { listBuyBoxes, listDeals } from "@backend/store/repository";
import { scoreDeal } from "@shared/domain/dealScore";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { matchBuyBox } from "@shared/domain/matching";
import { STRUCTURE_LABELS } from "@shared/domain/strategies";
import { gbp, percent } from "@shared/format";
import { SiteHeader } from "@/app/components/chrome";
import { MandateControls } from "@/app/components/mandate";
import { requireOperator } from "@/app/operator/guard";
import { SignOutButton } from "@/app/operator/SignOutButton";
import { BuyBoxForm } from "./BuyBoxForm";
import { removeBuyBox, setBuyBoxActive } from "./actions";
import type { BuyBox } from "@shared/domain/matching";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Buy Boxes — Lode",
  description: "Investor mandates, and the live deals each one actually matches.",
};

/**
 * Buy Box marketplace.
 *
 * Every mandate is shown with the deals it currently matches, computed rather
 * than claimed. That is the whole point of the page: a mandate nobody can
 * satisfy is a mandate whose criteria are wrong, and the only way to know is to
 * run it against the pipeline in front of the person who wrote it.
 */
export default async function InvestPage() {
  await requireOperator("/invest");
  const [boxes, records] = await Promise.all([listBuyBoxes(), listDeals()]);

  const scored = records.map((record) => ({
    record,
    scored: scoreDeal(toWorkingDeal(record.inputs).inputs),
  }));

  const rows = boxes
    .map((box) => {
      const matches = scored
        .map(({ record, scored: s }) => ({ record, match: matchBuyBox(box, s) }))
        .filter(({ match }) => match.eligible)
        .sort((a, b) => b.match.score - a.match.score);
      return { box, matches };
    })
    .sort((a, b) => Number(b.box.active) - Number(a.box.active) || b.matches.length - a.matches.length);

  const activeCount = boxes.filter((b) => b.active).length;

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/deals" className="transition hover:text-ink-100">Deals</Link>
            <Link href="/invest" className="text-ink-100">Buy</Link>
            <Link href="/capital" className="transition hover:text-ink-100">Capital</Link>
            <SignOutButton />
          </nav>
        }
      />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <span className="eyebrow">
          Buy Box
        </span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {boxes.length === 0
            ? "No buying mandates yet"
            : `${activeCount} active ${activeCount === 1 ? "mandate" : "mandates"}`}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          These records are what a seller is counted against. When the seller options page says a
          buyer exists, it means one of these mandates was satisfied on every hard criterion — so
          an inactive or badly specified mandate is not a neutral thing to leave lying around.
        </p>

        <div className="mt-10">
          <BuyBoxForm />
        </div>

        {boxes.length === 0 ? (
          <p className="mt-10 rounded-2xl border hairline bg-surface-1 px-5 py-6 text-sm text-ink-400">
            Nothing here yet. Until at least one mandate exists, every seller who completes the
            intake is told that no buyer currently matches their property — which is true, and is
            why capital is recruited before sellers are marketed to.
          </p>
        ) : (
          <div className="mt-10 space-y-5">
            {rows.map(({ box, matches }) => (
              <BuyBoxCard key={box.id} box={box} matches={matches} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function BuyBoxCard({
  box,
  matches,
}: {
  box: BuyBox;
  matches: readonly { record: { id: string; reference: string }; match: { score: number } }[];
}) {
  return (
    <section
      className={`rounded-2xl border px-5 py-4 ${box.active ? "hairline bg-surface-1" : "border-ink-800 bg-ink-950/60"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="font-display text-[17px] leading-tight text-ink-100">{box.investorName}</h2>
            {!box.active && (
              <span className="rounded-md border border-ink-700 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-ink-500">
                Inactive
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-400">
            {gbp(box.minPrice)}–{gbp(box.maxPrice)} · {box.propertyTypes.join(", ")} ·{" "}
            {box.minBedrooms}+ bed ·{" "}
            {box.localities.length > 0 ? box.localities.join(", ") : "anywhere"}
          </p>
        </div>
        <MandateControls
          id={box.id}
          active={box.active}
          setActive={setBuyBoxActive}
          remove={removeBuyBox}
        />
      </div>

      <dl className="mt-5 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Stat k="Minimum margin" v={percent(box.minMarginBps, 1)} />
        <Stat k="Minimum yield" v={percent(box.minYieldBps, 1)} />
        <Stat k="Max refurbishment" v={gbp(box.maxRefurbishment)} />
        <Stat k="Minimum score" v={String(box.minDealScore)} />
      </dl>

      <p className="mt-4 text-xs text-ink-500">
        {box.acceptableStructures.map((s) => STRUCTURE_LABELS[s]).join(" · ")}
      </p>

      <div className="mt-5 border-t hairline pt-4">
        {matches.length === 0 ? (
          <p className="text-sm text-ink-400">
            No live deal meets every hard criterion. That is information about the mandate as much
            as about the pipeline.
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-200">
              {matches.length} live {matches.length === 1 ? "deal matches" : "deals match"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {matches.slice(0, 8).map(({ record, match }) => (
                <Link
                  key={record.id}
                  href={`/deals/${record.id}`}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border hairline bg-surface-2 px-3 text-[13px] text-ink-200 transition-colors hover:border-ink-600 hover:text-ink-100"
                >
                  {record.reference} · {match.score}
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{k}</dt>
      <dd className="tnum text-ink-100">{v}</dd>
    </div>
  );
}

import Link from "next/link";
import { listDeals, listFundingBoxes } from "@backend/store/repository";
import { scoreDeal } from "@shared/domain/dealScore";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { FUNDER_KIND_LABELS, matchFundingBox, type FundingBox } from "@shared/domain/matching";
import { add } from "@shared/money";
import { gbp, months, percent } from "@shared/format";
import { SiteHeader } from "@/app/components/chrome";
import { MandateControls } from "@/app/components/mandate";
import { requireOperator } from "@/app/operator/guard";
import { SignOutButton } from "@/app/operator/SignOutButton";
import { FundingBoxForm } from "./FundingBoxForm";
import { removeFundingBox, setFundingBoxActive } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Funding Boxes — Lode",
  description: "Capital mandates, and the live deals each one actually funds.",
};

/**
 * Funding Box marketplace.
 *
 * The mirror of `/invest`. Each mandate is shown against the live pipeline,
 * because a lender's first question is never "what is your platform" — it is
 * "what would you have sent me last month", and this page answers it from the
 * data rather than from a claim.
 */
export default async function CapitalPage() {
  await requireOperator("/capital");
  const [boxes, records] = await Promise.all([listFundingBoxes(), listDeals()]);

  const scored = records.map((record) => ({
    record,
    scored: scoreDeal(toWorkingDeal(record.inputs).inputs),
    completedDeals: record.borrowerCompletedDeals,
  }));

  const rows = boxes
    .map((box) => {
      const matches = scored
        .map(({ record, scored: s, completedDeals }) => ({
          record,
          match: matchFundingBox(box, s, completedDeals),
        }))
        .filter(({ match }) => match.eligible)
        .sort((a, b) => b.match.score - a.match.score);
      return { box, matches };
    })
    .sort(
      (a, b) => Number(b.box.active) - Number(a.box.active) || b.matches.length - a.matches.length,
    );

  const activeCount = boxes.filter((b) => b.active).length;
  // add() rather than reduce(+): Money is a branded integer count of pence and
  // the brand exists to stop exactly this kind of raw arithmetic creeping in.
  const totalCapital = add(...boxes.filter((b) => b.active).map((b) => b.capitalAvailable));

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/deals" className="transition hover:text-ink-100">Deals</Link>
            <Link href="/invest" className="transition hover:text-ink-100">Buy</Link>
            <Link href="/capital" className="text-ink-100">Capital</Link>
            <SignOutButton />
          </nav>
        }
      />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <span className="eyebrow">
          Funding Box
        </span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {boxes.length === 0
            ? "No capital mandates yet"
            : `${activeCount} active ${activeCount === 1 ? "mandate" : "mandates"}`}
        </h1>
        {boxes.length > 0 && (
          <p className="mt-3 tnum text-sm text-ink-300">
            {gbp(totalCapital)} of capital declared across active mandates.
          </p>
        )}
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          Declared capital is what a funder says they have, not money we hold or have verified. It
          is shown so the number can be interrogated rather than assumed, and no deal is introduced
          on the strength of it alone.
        </p>

        <div className="mt-10">
          <FundingBoxForm />
        </div>

        {boxes.length === 0 ? (
          <p className="mt-10 rounded-2xl border hairline bg-surface-1 px-5 py-6 text-sm text-ink-400">
            Nothing here yet. Recruiting capital before marketing to sellers is the sequence the
            product enforces: with no funding mandate, no deal can be shown a route to completion.
          </p>
        ) : (
          <div className="mt-10 space-y-5">
            {rows.map(({ box, matches }) => (
              <FundingBoxCard key={box.id} box={box} matches={matches} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function FundingBoxCard({
  box,
  matches,
}: {
  box: FundingBox;
  matches: readonly { record: { id: string; reference: string }; match: { score: number } }[];
}) {
  const kindLabel = FUNDER_KIND_LABELS[box.kind];

  return (
    <section
      className={`rounded-2xl border px-5 py-4 ${box.active ? "hairline bg-surface-1" : "border-ink-800 bg-ink-950/60"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="font-display text-[17px] leading-tight text-ink-100">{box.funderName}</h2>
            <span className="rounded border border-lode-500/45 bg-lode-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-lode-200">
              {kindLabel}
            </span>
            {!box.active && (
              <span className="rounded-md border border-ink-700 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-ink-500">
                Inactive
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-400">
            {gbp(box.minTicket)}–{gbp(box.maxTicket)} tickets ·{" "}
            {months(box.minTermMonths)}–{months(box.maxTermMonths)} ·{" "}
            {box.localities.length > 0 ? box.localities.join(", ") : "anywhere"}
          </p>
        </div>
        <MandateControls
          id={box.id}
          active={box.active}
          setActive={setFundingBoxActive}
          remove={removeFundingBox}
        />
      </div>

      <dl className="mt-5 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Stat k="Declared capital" v={gbp(box.capitalAvailable)} />
        <Stat k="Maximum LTV" v={percent(box.maxLtvBps, 1)} />
        <Stat k="Required return" v={percent(box.requiredReturnBps, 1)} />
        <Stat k="Track record" v={`${box.minBorrowerCompletedDeals}+ deals`} />
      </dl>

      <p className="mt-4 text-xs text-ink-500">
        {[
          box.acceptsRefurbishment ? "refurbishment" : undefined,
          box.acceptsDevelopment ? "development" : undefined,
          box.requiresFirstCharge ? "first charge required" : "second charge considered",
          box.personalGuaranteeRequired ? "PG required" : "no PG",
        ]
          .filter((s): s is string => s !== undefined)
          .join(" · ")}
      </p>

      <div className="mt-5 border-t hairline pt-4">
        {matches.length === 0 ? (
          <p className="text-sm text-ink-400">
            No live deal fits this mandate. Worth checking the LTV ceiling and the track-record
            minimum before concluding the pipeline is the problem.
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-200">
              {matches.length} live {matches.length === 1 ? "deal fits" : "deals fit"}
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

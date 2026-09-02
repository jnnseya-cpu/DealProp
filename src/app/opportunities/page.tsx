import Link from "next/link";
import { Badge, Panel, SiteHeader, scoreTone } from "@/app/components/chrome";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { offersFor } from "@backend/billing/reveal";
import { listDeals } from "@backend/store/repository";
import { gbp, titleCase } from "@shared/format";
import { REVEAL_GUARANTEE } from "@shared/domain/reveal";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Opportunities — Lode",
  description: "Verified opportunities, with what is known about each one stated plainly.",
};

/**
 * The marketplace, from the buying side.
 *
 * Every card carries its category sentence in the same place, at the same
 * weight, whether it flatters the opportunity or not. That is the point: a
 * platform that shows nine thousand AI-discovered addresses and forty
 * owner-verified ones under one heading called "opportunities" is selling the
 * first buyer who pays a lesson rather than a property.
 *
 * The card is a closed shape rather than a filtered deal. No address, no
 * seller situation, no return figure — see `opportunityCard()` for why each of
 * those is absent by construction rather than by omission.
 */
export default async function OpportunitiesPage() {
  const viewer = await requirePermission("view-deal-material", "/opportunities");
  const account = viewerAccount(viewer);

  const records = await listDeals();
  const offers = account === undefined ? [] : await offersFor(records, account);

  const openable = offers.filter((o) => o.quote.chargeable || o.opened !== undefined);
  const unconfirmed = offers.filter((o) => !o.quote.chargeable && o.opened === undefined);

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/opportunities" className="text-ink-100">Opportunities</Link>
            <Link href="/invest" className="transition hover:text-ink-100">Buy Boxes</Link>
            <Link href="/account/billing" className="transition hover:text-ink-100">Billing</Link>
          </nav>
        }
      />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <p className="eyebrow">Opportunities</p>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {offers.length === 0
            ? "Nothing on the market yet"
            : `${openable.length} you can open, ${unconfirmed.length} not yet confirmed`}
        </h1>
        <p className="mt-4 max-w-[42rem] text-[14px] leading-[1.6] text-ink-400">
          Every opportunity states who confirmed it is for sale. Where nobody has, it says so — and
          it cannot be opened for money, because paying to be introduced to somebody who never
          agreed to sell is not a transaction, it is a complaint waiting to happen.
        </p>
        <p className="mt-3 max-w-[42rem] text-[13px] leading-[1.6] text-ink-500">
          Ranked by what can be established, not by the largest discount. A property with an
          enormous theoretical margin and an unchecked title sits below a smaller one that can
          complete in three weeks, because a deal is worth its discount multiplied by the chance
          it happens.
        </p>

        {account === undefined && (
          <p className="mt-6 border-l-2 border-amber-500/80 py-1 pl-4 text-[13px] leading-[1.65] text-amber-300">
            Signed in with the shared operator password, which is nobody in particular. Opening an
            opportunity is a purchase by a named person, so sign in with an account to see prices.
          </p>
        )}

        {offers.length > 0 && (
          <div className="mt-9 space-y-3">
            {offers.map(({ card, opened, record, score }) => (
              <Link
                key={record.id}
                href={`/opportunities/${encodeURIComponent(record.id)}`}
                className="block rounded-r-lg border-y border-r border-l-2 hairline bg-surface-1 px-5 py-4 transition-colors hover:border-ink-600"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="font-display text-[17px] leading-tight text-ink-100">
                    {card.bedrooms > 0 ? `${card.bedrooms}-bed ` : ""}
                    {titleCase(card.propertyType.replace(/-/g, " "))} · {card.locality}
                  </h2>
                  <span className="tnum text-[15px] text-ink-200">{gbp(card.guidePrice)}</span>
                </div>
                <p className="mt-1 text-[12px] text-ink-500">
                  {card.area} · {titleCase(card.tenure.replace(/-/g, " "))} · {card.reference}
                </p>
                <p className="mt-2.5 text-[13px] leading-[1.6] text-ink-400">{card.disclosure}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2.5">
                  <span className={`tnum text-[15px] ${scoreTone(score.score)}`}>{score.score}</span>
                  <span className="text-[12px] text-ink-500">
                    {score.confidence} confidence · {score.evidenceUsed.length} of{" "}
                    {score.evidenceUsed.length + score.evidenceMissing.length} checks
                  </span>
                  <Badge tone={card.category === "ai-discovered" ? "warn" : "good"}>
                    {titleCase(card.category.replace(/-/g, " "))}
                  </Badge>
                  {opened !== undefined ? (
                    <Badge tone="neutral">Open to you</Badge>
                  ) : card.openable ? (
                    <span className="tnum text-[13px] text-lode-300">
                      {gbp(card.revealPrice)} to open
                    </span>
                  ) : (
                    <span className="text-[13px] text-ink-500">Not available to open</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}

        <Panel className="mt-10" eyebrow="If it is not what we said" title="What you get back">
          <ul className="space-y-2.5">
            {REVEAL_GUARANTEE.map((line) => (
              <li key={line} className="text-[13px] leading-[1.6] text-ink-300">
                {line}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </main>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Panel, SiteHeader, Stat } from "@/app/components/chrome";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { quoteRevealForDeal } from "@backend/billing/reveal";
import { gbp, titleCase } from "@shared/format";
import { REVEAL_GUARANTEE, SELLER_RESPONSE_DAYS } from "@shared/domain/reveal";
import { OpenForm, RefundForm } from "./Forms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Opportunity — Lode" };

/**
 * One opportunity, before and after it is opened.
 *
 * Before: the anonymous card, the category sentence, the price and the
 * guarantee. Not the address — the whole product is the introduction, and
 * giving away what is being introduced makes the fee a toll on information the
 * buyer already has.
 *
 * After: what was paid, what they were told at the time, and the claim form.
 * The disclosure shown is read from the purchase rather than recomputed, so a
 * later reclassification cannot rewrite what the buyer was sold.
 */
export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requirePermission("view-deal-material", `/opportunities/${id}`);
  const account = viewerAccount(viewer);

  const offer = await quoteRevealForDeal(id, account);
  if (offer === undefined) notFound();

  const { card, quote, opened, passport } = offer;

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        back="/opportunities"
        trailing={
          <nav className="flex items-center gap-5 text-[13px] text-ink-400">
            <Link href="/opportunities" className="transition-colors hover:text-ink-100">
              Opportunities
            </Link>
          </nav>
        }
      >
        <span className="font-mono text-xs text-ink-500">{card.reference}</span>
      </SiteHeader>

      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="eyebrow">{titleCase(card.opportunity.replace(/-/g, " "))}</p>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {card.bedrooms > 0 ? `${card.bedrooms}-bed ` : ""}
          {titleCase(card.propertyType.replace(/-/g, " "))} in {card.locality}
        </h1>

        <p
          className={`mt-5 border-l-2 py-1 pl-4 text-[14px] leading-[1.65] ${
            card.category === "ai-discovered"
              ? "border-amber-500/80 text-amber-200"
              : "border-emerald-500/80 text-ink-200"
          }`}
        >
          {card.disclosure}
        </p>

        <div className="mt-8 grid grid-cols-2 gap-6 border-y hairline py-6 sm:grid-cols-4">
          <Stat label="Guide price" value={gbp(card.guidePrice)} size="sm" />
          <Stat label="Area" value={card.area} size="sm" tone="text-ink-300" />
          <Stat label="Tenure" value={titleCase(card.tenure.replace(/-/g, " "))} size="sm" tone="text-ink-300" />
          <Stat
            label={opened === undefined ? "To open" : "You paid"}
            value={gbp(opened?.paid ?? card.revealPrice)}
            size="sm"
          />
        </div>

        {opened === undefined ? (
          <Panel
            className="mt-8"
            eyebrow="What the fee buys"
            title="The pack, the introduction, and the transaction intelligence"
            action={
              <Badge tone={quote.chargeable ? "good" : "warn"}>
                {quote.chargeable ? "Available" : "Not available"}
              </Badge>
            }
          >
            <p className="text-[13px] leading-[1.65] text-ink-300">
              It does not buy an address and it does not buy a telephone number. It buys a verified
              opportunity pack, an introduction to somebody who has agreed to be introduced, and
              what we know about how the transaction would actually work. If the seller does not
              answer within {SELLER_RESPONSE_DAYS} days, you get the fee back.
            </p>

            {quote.chargeable ? (
              <OpenForm dealId={id} price={gbp(quote.price)} />
            ) : (
              <ul className="mt-4 space-y-2.5 border-t hairline pt-4">
                {quote.blockers.map((blocker) => (
                  <li key={blocker.reason} className="text-[13px] leading-[1.6]">
                    <span className="text-ink-200">{blocker.reason}</span>{" "}
                    <span className="text-ink-500">{blocker.remedy}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : (
          <Panel className="mt-8" eyebrow="Open to you" title="What you were told when you paid">
            <p className="border-l-2 border-ink-600 py-1 pl-4 text-[13px] leading-[1.65] text-ink-200">
              &ldquo;{opened.disclosureShown}&rdquo;
              <span className="mt-1 block font-mono text-[11px] text-ink-500">
                {titleCase(opened.categoryAtPurchase.replace(/-/g, " "))} ·{" "}
                {opened.paidAt.slice(0, 16).replace("T", " ")}
              </span>
            </p>
            <p className="mt-3.5 text-[13px] leading-[1.65] text-ink-400">
              Kept as it was written rather than recomputed. If the opportunity is reclassified
              later, this is still what you paid for — and it is what a refund is judged against.
            </p>

            {opened.refundedAt === undefined ? (
              <RefundForm dealId={id} revealId={opened.id} />
            ) : (
              <p className="mt-4 border-t hairline pt-4 text-[13px] leading-[1.6] text-emerald-300">
                Refunded {opened.refundedAt.slice(0, 10)} — {opened.refundReason}
              </p>
            )}
          </Panel>
        )}

        {passport !== undefined && opened === undefined && (
          <Panel
            className="mt-6"
            eyebrow="Your passport"
            title={`Grade ${passport.grade} — ${passport.definition.label}`}
            action={
              <Badge tone={passport.mayApproachSeller ? "good" : "warn"}>
                {passport.mayApproachSeller ? "May be introduced" : "Not yet"}
              </Badge>
            }
          >
            <p className="text-[13px] leading-[1.65] text-ink-300">{passport.definition.meaning}</p>
            <ul className="mt-4 space-y-2.5 border-t hairline pt-4">
              {passport.checks.map((check) => (
                <li key={check.label} className="text-[13px] leading-[1.6]">
                  <span className={check.held ? "text-ink-100" : "text-amber-300"}>
                    {check.held ? "\u2713" : "\u2014"} {check.label}
                  </span>{" "}
                  <span className="text-ink-500">{check.detail}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 border-t hairline pt-4 text-[12px] leading-[1.6] text-ink-500">
              {passport.caveat}{" "}
              <Link href="/account/passport" className="text-lode-300 hover:underline">
                Record what is missing
              </Link>
              .
            </p>
          </Panel>
        )}

        <Panel className="mt-6" eyebrow="If it is not what we said" title="What you get back">
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

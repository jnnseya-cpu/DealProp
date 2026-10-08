import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/app/components/SiteFooter";
import { Badge, Panel, SiteHeader, Stat } from "@/app/components/chrome";
import { requirePermission } from "@/app/operator/guard";
import { getDeal } from "@backend/store/repository";
import { permissionsHeld } from "@backend/permissions";
import { gbp } from "@shared/format";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { sourcingFee, sourcingFeeHeadline } from "@shared/domain/pricing";
import { resolveCitation } from "@shared/domain/citations";
import {
  routeAllSourcing,
  SOURCING_RULES,
  type SourcingDecision,
  type SourcingRuling,
} from "@shared/domain/sourcing";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sourcing routes — Lode" };

/** The design system's own vocabulary, not a new set of colour names. */
const RULING_TONE: Record<SourcingRuling, "good" | "warn" | "bad"> = {
  PERMITTED: "good",
  REVIEW: "warn",
  REFUSED: "bad",
};

/**
 * Which sourcing routes are open on this deal, and what is closing the rest.
 *
 * The register and the ruling both existed before this page and neither was
 * reachable, which CLAUDE.md rule 42 says is the same as not existing. This is
 * the call site.
 *
 * It reads the permissions from the catalogue rather than taking a parameter,
 * so what it shows is what the fee engine and the revenue model would decide
 * on the same facts. A page that could be shown a different permission set
 * from the one that charges the fee would be a page that reassures.
 *
 * The facts it cannot know are shown as not recorded rather than assumed
 * favourably. A seller is treated as a consumer unless something says
 * otherwise, and nothing has been disclosed or evidenced until it has been —
 * which is why every route reads REFUSED on a deal nobody has worked yet, and
 * why that is the right first impression.
 */
export default async function SourcingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("view-seller-data", `/deals/${id}/sourcing`);

  const record = await getDeal(id);
  if (record === undefined) notFound();

  const working = toWorkingDeal(record.inputs);
  const price = working.inputs.purchasePrice;

  /*
   * What has actually been recorded against this deal.
   *
   * None of these has a field on `DealRecord` yet, so each is false and the
   * page says so. That is deliberate and it is the honest state: the routes
   * are refused because nothing has been evidenced, not because the engine is
   * pessimistic. Wiring the forms that record them is the next change, and
   * until then an operator reading this page is being told the truth about
   * where the deal stands rather than shown a hypothetical.
   */
  const decisions = routeAllSourcing({
    permissionsHeld: permissionsHeld(),
    // Absent information means more caution, never less — the same rule the
    // screening engine follows. An unknown seller is a consumer.
    sellerIsConsumer: true,
    conflictDisclosedToSeller: false,
    investorFundsEvidenced: false,
    feeTakenBeforeCompletion: false,
  });

  const open = decisions.filter((d) => d.ruling !== "REFUSED").length;

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 text-sm text-ink-400">
            <Link href={`/deals/${record.id}`} className="transition-colors hover:text-ink-100">
              Deal room
            </Link>
            <Link href={`/deals/${record.id}/fees`} className="transition-colors hover:text-ink-100">
              Fees
            </Link>
            <Link href="/operator/conduct" className="transition-colors hover:text-ink-100">
              Conduct
            </Link>
          </nav>
        }
      />

      <div className="mx-auto max-w-4xl px-6 py-10">
        <p className="eyebrow">Sourcing</p>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {open} of {decisions.length} routes open on {record.reference}
        </h1>
        <p className="mt-4 max-w-[42rem] text-[14px] leading-[1.6] text-ink-400">
          Deal sourcing means being paid for a deal without ever owning the property. All three
          routes below are lawful. Most people doing this are doing it unlawfully, and it is almost
          always one of two things: taking the fee before completion, or believing that acting for
          the buyer puts them outside the Estate Agents Act. It does not — section 1 covers a client
          who wishes to acquire as well as one who wishes to dispose.
        </p>

        <dl className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Price modelled" value={gbp(price)} />
          <Stat label="Fee at this price" value={gbp(sourcingFee(price, "percentage"))} />
          <Stat
            label="Routes open"
            value={`${open}/${decisions.length}`}
            tone={open === 0 ? "text-amber-300" : "text-emerald-300"}
          />
        </dl>

        <p className="mt-4 border-l-2 border-lode-400/70 py-1 pl-4 text-[13px] leading-[1.65] text-ink-400">
          The investor pays {sourcingFeeHeadline()}. Never before completion — a fee taken for a
          deal that then does not happen is the commonest cause of complaint and prosecution in
          this sector, and there is no stage in the fee engine that would allow it.
        </p>

        {SOURCING_RULES.requiresCounselApproval && (
          <p className="mt-4 border-l-2 border-amber-400/70 py-1 pl-4 text-[13px] leading-[1.65] text-ink-300">
            These routing rules have not been reviewed by a solicitor. Nothing below is legal
            advice, the pre-completion stamp duty treatment in particular is contested, and no route
            will read as permitted until counsel has cleared the rule set. Recorded as at{" "}
            {SOURCING_RULES.asOf}.
          </p>
        )}

        <div className="mt-10 space-y-5">
          {decisions.map((decision) => (
            <RouteCard key={decision.route.route} decision={decision} />
          ))}
        </div>
      </div>
      <SiteFooter width="max-w-4xl" />
    </main>
  );
}

function RouteCard({ decision }: { decision: SourcingDecision }) {
  const route = decision.route;

  return (
    <Panel
      eyebrow={route.label}
      title={decision.summary}
      action={<Badge tone={RULING_TONE[decision.ruling]}>{decision.ruling}</Badge>}
    >
      <p className="text-[13px] leading-[1.65] text-ink-300">{route.whatHappens}</p>

      <dl className="mt-4 divide-y divide-ink-800/70 border-t hairline">
        <Row k="Who we act for" v={route.client === "both" ? "Both parties" : route.client} />
        <Row k="Fee" v={route.feeBasis} />
        <Row k="Due" v="On completion, and at no earlier point" />
        <Row k="Transfer tax" v={route.transferTax} />
      </dl>

      <div className="mt-4">
        <p className="eyebrow">What the contract must do</p>
        <ul className="mt-2 space-y-1.5">
          {route.contractRequirements.map((requirement) => (
            <li key={requirement} className="flex gap-2 text-[13px] leading-[1.6] text-ink-300">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-lode-400" />
              {requirement}
            </li>
          ))}
        </ul>
      </div>

      {/* The risk, in its own box, because it is the thing that bankrupts
          somebody rather than the thing that fines them. */}
      <p className="mt-4 border-l-2 border-red-400/70 py-1 pl-4 text-[13px] leading-[1.65] text-ink-300">
        {route.principalRisk}
      </p>

      {decision.blockers.length > 0 && (
        <div className="mt-4">
          <p className="eyebrow">Why it is refused</p>
          <ul className="mt-2 space-y-3">
            {decision.blockers.map((blocker) => (
              <li key={blocker.reason}>
                <p className="text-[13px] text-ink-100">{blocker.reason}</p>
                <p className="mt-0.5 text-[13px] leading-[1.6] text-ink-400">{blocker.remedy}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {decision.reviews.length > 0 && (
        <div className="mt-4">
          <p className="eyebrow">A person must decide</p>
          <ul className="mt-2 space-y-3">
            {decision.reviews.map((review) => (
              <li key={review.reason}>
                <p className="text-[13px] text-ink-100">{review.reason}</p>
                <p className="mt-0.5 text-[13px] leading-[1.6] text-ink-400">{review.remedy}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 border-t hairline pt-4">
        <p className="eyebrow">Sources</p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {route.citations.map((key) => {
            const source = resolveCitation(key);
            return (
              <li key={key}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] text-lode-200 underline decoration-lode-500/40 underline-offset-2"
                >
                  {source.title}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-[13px] text-ink-400">{k}</dt>
      <dd className="text-[13px] leading-[1.6] text-ink-200">{v}</dd>
    </div>
  );
}

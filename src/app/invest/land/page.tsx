import Link from "next/link";
import { SiteHeader, Panel } from "@/app/components/chrome";
import { SiteFooter } from "@/app/components/SiteFooter";
import { requireMandateManagement } from "@/app/operator/guard";
import { SignOutButton } from "@/app/operator/SignOutButton";
import { landSourcing, type AcquisitionView } from "@backend/land/sourcingService";
import { landDisposals } from "@backend/land/disposalsService";
import { OpportunityCard, DisposalCard, AcquisitionTabs } from "@/app/components/land/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "Land sourcing — Lode" };

/**
 * Land sourcing — the investor surface.
 *
 * The same engine, store and shared cards as the operator console
 * (`/operator/land`), gated by `requireMandateManagement` so an investor or
 * funder (manage-own-mandates) reaches it, operators too. The feeds are public
 * Open Government Licence data — brownfield development sites and council
 * disposals — so there is no seller data here and no per-account scoping: every
 * signed-in investor sees the same national research. Acting on a site still
 * follows the ordinary workflow.
 */
export default async function InvestorLandPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireMandateManagement("/invest/land");

  const sp = await searchParams;
  const rawView = typeof sp.view === "string" ? sp.view : "all";
  const view: AcquisitionView = rawView === "buy" || rawView === "secure" ? rawView : "all";

  const sourcing = await landSourcing({ view });
  const disposals = await landDisposals();

  return (
    <main data-accent="teal" className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <>
            <Link href="/invest" className="text-[13px] text-ink-400 hover:text-ink-200">Buy Boxes</Link>
            <Link href="/invest/hunts" className="text-[13px] text-ink-400 hover:text-ink-200">Deal Hunts</Link>
            <SignOutButton />
          </>
        }
      />
      <div className="mx-auto max-w-4xl px-6 py-10">
        <span className="eyebrow">Sourcing</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          Land sourcing
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          Development land across England, from public open data — previously-developed sites each authority
          judges suitable for housing, and councils&rsquo; own land and property disposals. Each is assessed
          for what could be built, which control structure fits (buy a consented plot, or secure land by
          option / conditional / promotion), and a sourceability score. Market research, openly licensed; how
          you act on a site is up to you.
        </p>

        <h2 className="mt-10 font-display text-[20px] text-ink-100">Development sites</h2>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-400">
          Brownfield Land Registers (planning.data.gov.uk, Open Government Licence), ranked by sourceability.
          The register&rsquo;s dwelling capacity is the authority&rsquo;s; the engine estimate is ours.
        </p>

        <AcquisitionTabs basePath="/invest/land" current={view} />

        {sourcing.sites.length === 0 ? (
          <Panel className="mt-6" eyebrow="Coverage" title="No development sites to show">
            <p className="text-sm leading-relaxed text-ink-300">
              {sourcing.feedConnected && (sourcing.total ?? 0) > 0
                ? "No sites match this view right now — try the All tab."
                : "No development sites are available yet. This fills as the national register is loaded."}
            </p>
          </Panel>
        ) : (
          <>
            {sourcing.total !== undefined && (
              <p className="mt-6 border-l-2 border-[color:var(--accent)] py-1 pl-4 text-[13px] leading-relaxed text-ink-400">
                Top {sourcing.sites.length} by sourceability of {sourcing.total.toLocaleString("en-GB")} sites.
              </p>
            )}
            {sourcing.sites.map((s) => (
              <OpportunityCard key={s.opportunity.id} s={s} />
            ))}
          </>
        )}

        <h2 className="mt-12 font-display text-[20px] text-ink-100">Live disposals</h2>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-400">
          Councils and public bodies advertising land and property for sale (Contracts Finder, Open Government
          Licence), soonest deadline first. Services procurement is filtered out.
        </p>
        {disposals.disposals.length === 0 ? (
          <Panel className="mt-6" eyebrow="Coverage" title="No live disposals right now">
            <p className="text-sm leading-relaxed text-ink-300">
              There are no current public-sector land disposals to show. Expired notices are dropped
              automatically, so this reflects what is genuinely open.
            </p>
          </Panel>
        ) : (
          <>
            {disposals.disposals.map((d) => (
              <DisposalCard key={d.id} d={d} />
            ))}
          </>
        )}
      </div>
      <SiteFooter />
    </main>
  );
}

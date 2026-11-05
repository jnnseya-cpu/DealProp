import Link from "next/link";
import { SiteHeader, Panel } from "@/app/components/chrome";
import { SiteFooter } from "@/app/components/SiteFooter";
import { requireMandateManagement, viewerAccountId } from "@/app/operator/guard";
import { SignOutButton } from "@/app/operator/SignOutButton";
import { listDealHuntRuns, listWatchCursors } from "@backend/store/repository";
import { interpret } from "@backend/dealHunt/service";
import { fixturesEnabled } from "@backend/dealHunt/fixtureSource";
import { runHuntAction } from "@/app/operator/hunts/actions";
import { HuntRunsList, HuntWatchesList } from "@/app/components/hunt/views";
import { HuntBrief, HuntConfirmForm } from "@/app/components/hunt/brief";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deal Hunts — Lode" };

/**
 * Ask LODE for Deals — the investor surface (Deal Hunt spec §1, "a signed-in
 * investor"). Same engine and shared views as the operator console, gated by
 * `requireMandateManagement` and scoped to the investor's own account. A listed
 * result is market research; any introduction or pack release still follows the
 * existing approval workflow.
 */
export default async function InvestorHuntsPage({
  searchParams,
}: {
  searchParams: Promise<{ brief?: string; error?: string }>;
}) {
  const viewer = await requireMandateManagement("/invest/hunts");
  const ownerId = viewerAccountId(viewer);
  const sp = await searchParams;
  const brief = typeof sp.brief === "string" ? sp.brief : "";
  const interpreted = brief.trim() !== "" ? interpret(brief) : undefined;
  const runs = ownerId !== undefined ? await listDealHuntRuns(ownerId) : [];
  const watches = ownerId !== undefined ? await listWatchCursors(ownerId) : [];

  return (
    <main data-accent="violet" className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <>
            <Link href="/invest" className="text-[13px] text-ink-400 hover:text-ink-200">Buy Boxes</Link>
            <SignOutButton />
          </>
        }
      />
      <div className="mx-auto max-w-4xl px-6 py-10">
        <span className="eyebrow">Ask LODE for Deals</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          Deal Hunts
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          Describe the opportunity in plain English — LODE reads it into editable filters, shows what
          it understood, and runs a deterministic hunt over its monitored set. Every figure is
          evidenced; a hunt with nothing to show says so, with its coverage.
        </p>
        {!fixturesEnabled() && (
          <p className="mt-4 max-w-2xl border-l-2 border-[color:var(--accent)] py-1 pl-4 text-[13px] leading-relaxed text-ink-400">
            Investor display of live listings depends on a licensed feed&rsquo;s terms. Until one is
            enabled here, a hunt returns an explicit zero-match with its coverage boundary rather than
            an unlicensed or invented result.
          </p>
        )}

        {sp.error !== undefined && (
          <p className="mt-6 border-l-2 border-red-500/80 py-1 pl-4 text-sm text-red-300">{sp.error}</p>
        )}

        <HuntBrief brief={brief} base="/invest/hunts" />

        {interpreted !== undefined && interpreted.draft !== undefined && (
          <Panel className="mt-8" eyebrow="Interpretation" title={interpreted.interpretation}>
            {interpreted.clarifications.length > 0 && (
              <ul className="mb-4 space-y-2">
                {interpreted.clarifications.map((c) => (
                  <li key={c.field} className="border-l-2 border-amber-500/80 py-1 pl-3 text-[13px] text-amber-200/90">
                    {c.message}
                  </li>
                ))}
              </ul>
            )}
            <HuntConfirmForm brief={brief} draft={interpreted.draft} action={runHuntAction} base="/invest/hunts" />
          </Panel>
        )}

        <h2 className="eyebrow mt-12">My Deal Hunts</h2>
        <HuntRunsList runs={runs} base="/invest/hunts" />
        <HuntWatchesList watches={watches} base="/invest/hunts" />
      </div>
      <SiteFooter />
    </main>
  );
}

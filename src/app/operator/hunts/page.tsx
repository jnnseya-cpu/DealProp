import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader, Panel } from "@/app/components/chrome";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { listDealHuntRuns, listWatchCursors } from "@backend/store/repository";
import { interpret } from "@backend/dealHunt/service";
import { fixturesEnabled } from "@backend/dealHunt/fixtureSource";
import { runHuntAction } from "@/app/operator/hunts/actions";
import { HuntRunsList, HuntWatchesList } from "@/app/components/hunt/views";
import { HuntBrief, HuntConfirmForm } from "@/app/components/hunt/brief";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deal Hunts — Lode" };

/**
 * Ask LODE for Deals — the staff pilot console (Deal Hunt spec §1). The investor
 * surface at /invest/hunts renders the same engine and shared views; this one is
 * the operator view of it.
 */
export default async function HuntsPage({
  searchParams,
}: {
  searchParams: Promise<{ brief?: string; error?: string }>;
}) {
  const viewer = await requirePermission("view-audit-log", "/operator/hunts");
  const account = viewerAccount(viewer);
  const sp = await searchParams;
  const brief = typeof sp.brief === "string" ? sp.brief : "";
  const interpreted = brief.trim() !== "" ? interpret(brief) : undefined;
  const runs = account !== undefined ? await listDealHuntRuns(account.id) : [];
  const watches = account !== undefined ? await listWatchCursors(account.id) : [];

  return (
    <main data-accent="violet" className="min-h-screen pb-24">
      <SiteHeader trailing={<OperatorNav current="/operator/hunts" />} />
      <div className="mx-auto max-w-4xl px-6 py-10">
        <span className="eyebrow">Ask LODE for Deals</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          Deal Hunts
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          Describe the opportunity in plain English. LODE reads it into editable filters, shows what
          it understood, and runs a deterministic hunt over the monitored set. Every figure is
          evidenced; a hunt with nothing to show says so.
        </p>
        {!fixturesEnabled() && (
          <p className="mt-4 max-w-2xl border-l-2 border-[color:var(--accent)] py-1 pl-4 text-[13px] leading-relaxed text-ink-400">
            No licensed listing feed is enabled in this deployment, so a hunt returns an explicit
            zero-match with its coverage boundary rather than an invented result. Set{" "}
            <code className="font-mono text-[12px] text-ink-300">DEAL_HUNT_FIXTURES=1</code> for a
            staff pilot over synthetic data.
          </p>
        )}

        {sp.error !== undefined && (
          <p className="mt-6 border-l-2 border-red-500/80 py-1 pl-4 text-sm text-red-300">{sp.error}</p>
        )}

        <HuntBrief brief={brief} base="/operator/hunts" />

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
            <HuntConfirmForm brief={brief} draft={interpreted.draft} action={runHuntAction} base="/operator/hunts" />
          </Panel>
        )}

        <h2 className="eyebrow mt-12">My Deal Hunts</h2>
        <HuntRunsList runs={runs} base="/operator/hunts" />
        <HuntWatchesList watches={watches} base="/operator/hunts" />
      </div>
    </main>
  );
}

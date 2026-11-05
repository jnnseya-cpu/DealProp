import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader, Panel, Badge, Button } from "@/app/components/chrome";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { listDealHuntRuns, listWatchCursors } from "@backend/store/repository";
import { interpret } from "@backend/dealHunt/service";
import { fixturesEnabled } from "@backend/dealHunt/fixtureSource";
import type { DealHuntRunState } from "@shared/domain/dealHuntRun";
import { runHuntAction, runWatchAction } from "@/app/operator/hunts/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deal Hunts — Lode" };

/**
 * Ask LODE for Deals — the staff pilot console (Deal Hunt spec §1).
 *
 * Investor display depends on a licensed feed's terms; until one is approved
 * this is the internal research surface. A named operator types a brief, LODE
 * interprets it into editable, typed filters and shows what it understood before
 * anything runs (DH01), blocks a live hunt on an unresolved geography or missing
 * budget (DH02), then queues a deterministic run whose evidenced shortlist — or
 * explicit zero-match coverage boundary — lands in My Deal Hunts.
 */

const STATE_TONE: Record<DealHuntRunState, "neutral" | "accent" | "good" | "warn" | "bad"> = {
  queued: "neutral",
  searching: "accent",
  enriching: "accent",
  completed: "good",
  partial: "warn",
  failed: "bad",
  cancelled: "neutral",
};

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

  const d = interpreted?.draft;

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

        {/* The brief. A GET form so the interpretation is a shareable URL. */}
        <form method="get" className="mt-8">
          <label htmlFor="brief" className="text-[13px] font-medium text-ink-200">
            Your brief
          </label>
          <textarea
            id="brief"
            name="brief"
            rows={3}
            defaultValue={brief}
            placeholder="2–3 bed houses in Birmingham under £225,000 that returned to market in the last 30 days and dropped at least 5%"
            className="mt-2 w-full rounded-lg border hairline bg-surface-2 px-3 py-2.5 text-sm text-ink-100 placeholder:text-ink-600"
          />
          <div className="mt-2.5">
            <Button type="submit" variant="secondary">Interpret</Button>
          </div>
        </form>

        {interpreted !== undefined && d !== undefined && (
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

            {/* Confirm editable criteria, then run. */}
            <form action={runHuntAction} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="brief" value={brief} />
              <Field label="Geography ID" name="geographyId" defaultValue={d.geographyId ?? ""} placeholder="pilot-birmingham" />
              <Field label="Property types (comma)" name="propertyTypes" defaultValue={(d.propertyTypes ?? []).join(", ")} placeholder="house" />
              <Field label="Price ceiling (£)" name="priceCeilingMajor" type="number" defaultValue={d.askingPriceLimitPence !== undefined ? String(Math.round(d.askingPriceLimitPence / 100)) : ""} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Beds min" name="bedroomsMin" type="number" defaultValue={d.bedroomsMin !== undefined ? String(d.bedroomsMin) : ""} />
                <Field label="Beds max" name="bedroomsMax" type="number" defaultValue={d.bedroomsMax !== undefined ? String(d.bedroomsMax) : ""} />
              </div>
              <Field label="Returned within (days)" name="returnedWithinDays" type="number" defaultValue={String(d.returnedWithinDays ?? 30)} />
              <Field label="Minimum drop (%)" name="minimumDropPercent" type="number" defaultValue={d.minimumDropBps !== undefined ? String(d.minimumDropBps / 100) : "0"} />
              <div>
                <label className="text-[11px] font-medium uppercase tracking-[0.09em] text-ink-400">Event</label>
                <select name="eventRequirement" defaultValue="returned_to_market" className="mt-1 w-full rounded-md border hairline bg-surface-2 px-2 py-1.5 text-sm text-ink-100">
                  <option value="returned_to_market">Returned to market</option>
                  <option value="confirmed_fall_through">Confirmed fall-through</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-[0.09em] text-ink-400">Price operator</label>
                <select name="priceOperator" defaultValue="lt" className="mt-1 w-full rounded-md border hairline bg-surface-2 px-2 py-1.5 text-sm text-ink-100">
                  <option value="lt">Under (strict)</option>
                  <option value="lte">At or under</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" variant="primary">Run this hunt</Button>
              </div>
            </form>
          </Panel>
        )}

        <h2 className="eyebrow mt-12">My Deal Hunts</h2>
        {runs.length === 0 ? (
          <p className="mt-3 rounded-2xl border hairline bg-surface-1 px-5 py-6 text-sm text-ink-400">
            No hunts yet. Interpret a brief above and run one.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-800/60 overflow-hidden rounded-2xl border hairline bg-surface-1">
            {runs.map((r) => (
              <li key={r.id}>
                <a href={`/operator/hunts/${r.id}`} className="row-hover flex flex-col gap-1.5 px-5 py-3.5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <Badge tone={STATE_TONE[r.state]}>{r.state}</Badge>
                      {r.counts !== undefined && (
                        <span className="text-sm text-ink-200">
                          {r.counts.eligible} match{r.counts.eligible === 1 ? "" : "es"}
                          {r.counts.capped ? " (capped)" : ""}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-ink-600 tabular-nums">{r.createdAt.replace("T", " ").slice(0, 16)}</span>
                  </div>
                  <p className="text-[13px] text-ink-400">{r.coverage}</p>
                </a>
              </li>
            ))}
          </ul>
        )}

        {watches.length > 0 && (
          <>
            <h2 className="eyebrow mt-12">My watches</h2>
            <ul className="mt-3 divide-y divide-ink-800/60 overflow-hidden rounded-2xl border hairline bg-surface-1">
              {watches.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone={w.enabled ? "good" : "neutral"}>{w.enabled ? "active" : "paused"}</Badge>
                      <span className="text-sm text-ink-200">{w.dedupeKeys.length} episode{w.dedupeKeys.length === 1 ? "" : "s"} alerted</span>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-ink-600">query {w.queryId.slice(0, 8)} · since {w.watermark.slice(0, 10)}</p>
                  </div>
                  <form action={runWatchAction}>
                    <input type="hidden" name="watchId" value={w.id} />
                    <button
                      type="submit"
                      className="h-7 shrink-0 rounded-md border hairline bg-surface-2 px-2.5 text-xs text-ink-200 transition-colors hover:border-ink-600 hover:bg-surface-3"
                    >
                      Run now
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="text-[11px] font-medium uppercase tracking-[0.09em] text-ink-400">{label}</label>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border hairline bg-surface-2 px-2 py-1.5 text-sm text-ink-100 placeholder:text-ink-600"
      />
    </div>
  );
}

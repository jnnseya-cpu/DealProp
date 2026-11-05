import { notFound } from "next/navigation";
import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader, Panel, Badge, Stat } from "@/app/components/chrome";
import { requirePermission } from "@/app/operator/guard";
import { getComparisonRun } from "@backend/store/repository";
import { alignComparison } from "@shared/domain/comparison";
import { gbp } from "@shared/format";
import type { DecisionVerdict } from "@shared/domain/decisionOutput";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compare — Lode" };

const VERDICT_TONE: Record<DecisionVerdict, "neutral" | "accent" | "good" | "warn" | "bad"> = {
  "within-target": "good",
  "below-target": "warn",
  "needs-evidence": "neutral",
  blocked: "bad",
};

export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("view-audit-log", "/operator/hunts");
  const { id } = await params;
  const run = await getComparisonRun(id);
  if (run === undefined) notFound();
  const cols = alignComparison(run);

  return (
    <main data-accent="violet" className="min-h-screen pb-24">
      <SiteHeader trailing={<OperatorNav current="/operator/hunts" />} />
      <div className="mx-auto max-w-5xl px-6 py-10">
        <a href="/operator/hunts" className="text-[13px] text-ink-400 hover:text-ink-200">&larr; All hunts</a>
        <span className="eyebrow mt-3 block">Compare and Decide</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-tight text-ink-100 sm:text-[32px]">
          {cols.length} properties, one assumption set
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-300">
          Judged under the shared <span className="text-ink-100">{run.sharedAssumptions.strategy}</span> assumptions
          (v{run.sharedAssumptions.version}). Property-specific departures are flagged.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {cols.map((c) => (
            <Panel key={c.propertyId} eyebrow={c.propertyId} title={c.label}>
              <div className="flex items-center gap-2">
                <Badge tone={VERDICT_TONE[c.verdict]}>{c.verdict.replace("-", " ")}</Badge>
                {c.hasOverrides && <Badge tone="warn">has overrides</Badge>}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Stat label="Max supported" value={gbp(c.maxSupportedPricePence)} size="sm" />
                <Stat label="Current ask" value={gbp(c.currentAskPence)} size="sm" />
                <Stat label="Headroom" value={gbp(c.headroomPence)} size="sm" warn={Number(c.headroomPence) < 0} />
                <Stat label="Downside" value={gbp(c.downsidePence)} size="sm" />
              </div>
              {c.missing.length > 0 && (
                <p className="mt-3 text-[12px] text-ink-500">Missing: {c.missing.join(", ")}</p>
              )}
              {c.nextCheck !== undefined && <p className="mt-1 text-[12px] text-ink-400">Next: {c.nextCheck}</p>}
              {c.overrides.map((o) => (
                <p key={o.field} className="mt-1 text-[12px] text-amber-200/90">{o.field}: {o.value}</p>
              ))}
            </Panel>
          ))}
        </div>
      </div>
    </main>
  );
}

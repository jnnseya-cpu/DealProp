import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader, Panel, Stat } from "@/app/components/chrome";
import { BarList, type BarDatum } from "@/app/components/charts";
import { requireOperator } from "@/app/operator/guard";
import { listAccounts, listBuyBoxes, listDeals, listFundingBoxes } from "@backend/store/repository";
import { supplyPosition } from "@shared/domain/supply";
import { scoreDeal } from "@shared/domain/dealScore";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import type { DealStatus } from "@shared/domain/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Overview — Lode" };

/**
 * The operator cockpit.
 *
 * One read of the platform's real position, drawn rather than listed. Every
 * figure comes from an engine or the store at render time — the supply counts
 * from `supplyPosition`, the distribution from `scoreDeal` run over the deals
 * on record, the groupings from the records themselves. Nothing here is a
 * seeded headline.
 *
 * The scan is unbounded on purpose, the same reasoning the landing records: an
 * aggregate that answers "what is the whole position" is wrong if it answers
 * for a page of it. Operators are few and the page is `force-dynamic`, so the
 * cost is paid by the handful of people who are entitled to the answer.
 */
export default async function OperatorDashboard() {
  await requireOperator("/operator/dashboard");

  const [deals, buyBoxes, fundingBoxes, accounts] = await Promise.all([
    listDeals(),
    listBuyBoxes(),
    listFundingBoxes(),
    listAccounts(),
  ]);

  // Score each deal once, the same call the supply position uses for its
  // blocked flag, so the distribution and the headline never disagree.
  const scored = deals.map((d) => scoreDeal(toWorkingDeal(d.inputs).inputs));

  const supply = supplyPosition(
    deals.map((d, i) => ({
      createdAt: d.createdAt,
      status: d.status,
      postcodeArea: d.property.postcodeArea,
      locality: d.property.locality,
      jurisdiction: d.property.jurisdiction,
      blocked: scored[i]!.protection.blocked,
    })),
    {
      buy: buyBoxes.filter((b) => b.active).length,
      funding: fundingBoxes.filter((b) => b.active).length,
    },
  );

  // Deals by lifecycle stage. A fixed order and a label each, so a sixth status
  // is a type error here rather than a silent omission from the chart.
  const STAGE_LABELS: Record<DealStatus, string> = {
    new: "New",
    qualified: "Qualified",
    "in-market": "In market",
    funded: "Funded",
    completed: "Completed",
    withdrawn: "Withdrawn",
  };
  const stageData: BarDatum[] = (Object.keys(STAGE_LABELS) as DealStatus[]).map((status) => ({
    label: STAGE_LABELS[status],
    value: deals.filter((d) => d.status === status).length,
  }));

  // Deal-position distribution, banded to match the verdict thresholds and
  // coloured from the same scale as the score itself (chrome.scoreBg).
  const BANDS = [
    { label: "Proceed · 78–100", min: 78, fill: "bg-emerald-500" },
    { label: "Negotiate · 60–77", min: 60, fill: "bg-amber-500" },
    { label: "Restructure · 40–59", min: 40, fill: "bg-orange-500" },
    { label: "Walk away · 0–39", min: 0, fill: "bg-red-500" },
  ] as const;
  const bandData: BarDatum[] = BANDS.map((band, i) => {
    const upper = i === 0 ? Infinity : BANDS[i - 1]!.min;
    return {
      label: band.label,
      value: scored.filter((s) => s.breakdown.composite >= band.min && s.breakdown.composite < upper).length,
      fill: band.fill,
    };
  });

  // Where the supply actually is — deals per postcode area, busiest first.
  const areaCounts = new Map<string, number>();
  for (const d of deals) {
    const key = d.property.postcodeArea || "—";
    areaCounts.set(key, (areaCounts.get(key) ?? 0) + 1);
  }
  const areaData: BarDatum[] = [...areaCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([area, count]) => ({ label: area, value: count }));

  // Accounts by role.
  const roleCounts = new Map<string, number>();
  for (const a of accounts) roleCounts.set(a.role, (roleCounts.get(a.role) ?? 0) + 1);
  const roleData: BarDatum[] = [...roleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([role, count]) => ({ label: role.charAt(0).toUpperCase() + role.slice(1), value: count }));

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader trailing={<OperatorNav current="/operator/dashboard" />} />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <span className="eyebrow">Overview</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          The platform right now
        </h1>
        <p className="mt-4 max-w-2xl border-l-2 border-lode-400/70 py-1 pl-4 text-sm leading-relaxed text-ink-300">
          {supply.summary}
        </p>

        <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Open" value={String(supply.open)} note="actionable today" />
          <Stat label="Total deals" value={String(supply.total)} note={`${supply.recent} added recently`} />
          <Stat label="Completed" value={String(supply.completed)} tone="text-emerald-300" />
          <Stat
            label="Protection-blocked"
            value={String(supply.blocked)}
            warn={supply.blocked > 0}
            note="capped, never counted as open"
          />
          <Stat label="Capital mandates" value={String(supply.fundingMandates)} note={`${supply.buyMandates} buying`} />
          <Stat label="Accounts" value={String(accounts.length)} />
        </dl>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <Panel eyebrow="Pipeline" title="Deals by stage">
            <BarList data={stageData} empty="No deals on the platform yet." />
          </Panel>

          <Panel eyebrow="Quality" title="Deal-position distribution">
            <BarList data={bandData} empty="No deals to score yet." />
            <p className="mt-4 text-[11px] leading-snug text-ink-500">
              Composite score, computed after profit tax. A protection block caps a deal at 35, so a
              blocked deal lands in the lowest band by construction.
            </p>
          </Panel>

          <Panel eyebrow="Geography" title="Where the supply is">
            <BarList data={areaData} empty="No postcode areas on record yet." />
          </Panel>

          <Panel eyebrow="Demand" title="Accounts by role">
            <BarList data={roleData} empty="No accounts created yet." />
          </Panel>
        </div>
      </div>
    </main>
  );
}

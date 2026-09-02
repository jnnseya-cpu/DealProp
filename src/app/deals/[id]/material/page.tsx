import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Panel, SiteHeader, Stat } from "@/app/components/chrome";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { audit } from "@backend/audit";
import { getDeal } from "@backend/store/repository";
import { appraise } from "@shared/domain/economics";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { materialInformation, type Knowledge } from "@shared/domain/materialInformation";
import { MaterialForm } from "./Form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Material information — Lode" };

/** The stored answer, flattened into what the form needs to show. */
function currentOf(knowledge: Knowledge | undefined): { state: string; text: string } | undefined {
  if (knowledge === undefined) return undefined;
  switch (knowledge.state) {
    case "stated":
      return { state: "stated", text: knowledge.value };
    case "not-applicable":
      return { state: "not-applicable", text: knowledge.why };
    case "not-known":
      return { state: "not-known", text: knowledge.whoWasAsked };
  }
}

/**
 * What has to be answered before this property may be marketed.
 *
 * Part A is a hard gate and the page says so at the top rather than at the
 * bottom of a list. Everything else is answerable with "we asked and do not
 * know", which is published as written — the point is that every question has
 * an answer, not that every answer is a fact.
 */
export default async function MaterialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requirePermission("view-seller-data", `/deals/${id}/material`);
  const record = await getDeal(id);
  if (record === undefined) notFound();

  const named = viewerAccount(viewer);
  await audit("viewed-deal-material", {
    ...(named !== undefined ? { account: named } : {}),
    subject: record.id,
    detail: `${record.reference} (material information)`,
  });

  const property = appraise(toWorkingDeal(record.inputs).inputs).inputs.property;
  const report = materialInformation(property, record.material ?? {});
  const answered = report.items.length - report.missingPartA.length - report.unanswered.length;

  return (
    <main className="min-h-screen pb-20">
      <SiteHeader
        back={`/deals/${record.id}`}
        trailing={
          <nav className="flex items-center gap-5 text-[13px] text-ink-400">
            <Link href={`/deals/${record.id}`} className="transition-colors hover:text-ink-100">
              Deal Room
            </Link>
            <Link href={`/deals/${record.id}/fees`} className="transition-colors hover:text-ink-100">
              Fees
            </Link>
          </nav>
        }
      >
        <span className="font-mono text-xs text-ink-500">{record.reference}</span>
      </SiteHeader>

      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="eyebrow">Material information</p>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {report.mayMarket ? "May be marketed" : "May not be marketed yet"}
        </h1>
        <p className="mt-4 max-w-[38rem] text-[14px] leading-[1.6] text-ink-400">{report.summary}</p>

        <div className="mt-8 grid grid-cols-3 gap-6 border-y hairline py-6">
          <Stat label="Answered" value={`${answered} of ${report.items.length}`} size="sm" />
          <Stat
            label="Part A missing"
            value={String(report.missingPartA.length)}
            size="sm"
            tone={report.missingPartA.length > 0 ? "text-amber-300" : "text-emerald-300"}
          />
          <Stat label="Unanswered" value={String(report.unanswered.length)} size="sm" tone="text-ink-300" />
        </div>

        {(["A", "B", "C"] as const).map((part) => {
          const rows = report.items.filter((s) => s.item.part === part);
          if (rows.length === 0) return null;
          return (
            <Panel
              key={part}
              className="mt-6"
              eyebrow={`Part ${part}`}
              title={
                part === "A"
                  ? "Every property, no exceptions"
                  : part === "B"
                    ? "Every property, once somebody has asked"
                    : "Where it exists"
              }
              action={
                <Badge tone={rows.every((r) => r.answered) ? "good" : part === "A" ? "warn" : "neutral"}>
                  {rows.filter((r) => r.answered).length} of {rows.length}
                </Badge>
              }
            >
              <ul className="space-y-5">
                {rows.map((row) => (
                  <li key={row.item.key} className="border-b hairline pb-5 last:border-0 last:pb-0">
                    <p className="text-[14px] leading-[1.5] text-ink-100">{row.item.label}</p>
                    <p className="mt-1 text-[12px] leading-[1.6] text-ink-500">{row.item.why}</p>
                    <p
                      className={`mt-2 text-[13px] leading-[1.6] ${row.answered ? "text-ink-300" : "text-amber-300"}`}
                    >
                      {row.shown}
                    </p>
                    <MaterialForm
                      dealId={record.id}
                      itemKey={row.item.key}
                      alwaysApplies={row.item.alwaysApplies}
                      {...(currentOf(row.knowledge) !== undefined
                        ? { current: currentOf(row.knowledge) }
                        : {})}
                    />
                  </li>
                ))}
              </ul>
            </Panel>
          );
        })}
      </div>
    </main>
  );
}

import { notFound } from "next/navigation";
import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader } from "@/app/components/chrome";
import { requirePermission } from "@/app/operator/guard";
import { getComparisonRun } from "@backend/store/repository";
import { ComparisonView } from "@/app/components/hunt/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compare — Lode" };

export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("view-audit-log", "/operator/hunts");
  const { id } = await params;
  const run = await getComparisonRun(id);
  if (run === undefined) notFound();

  return (
    <main data-accent="violet" className="min-h-screen pb-24">
      <SiteHeader trailing={<OperatorNav current="/operator/hunts" />} />
      <div className="mx-auto max-w-5xl px-6 py-10">
        <a href="/operator/hunts" className="text-[13px] text-ink-400 hover:text-ink-200">&larr; All hunts</a>
        <ComparisonView run={run} />
      </div>
    </main>
  );
}

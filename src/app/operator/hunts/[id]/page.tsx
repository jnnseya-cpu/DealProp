import { notFound } from "next/navigation";
import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader } from "@/app/components/chrome";
import { requirePermission } from "@/app/operator/guard";
import { loadHuntDetail } from "@backend/dealHunt/read";
import { HuntShortlist } from "@/app/components/hunt/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deal Hunt — Lode" };

export default async function HuntDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("view-audit-log", "/operator/hunts");
  const { id } = await params;
  const detail = await loadHuntDetail(id);
  if (detail === undefined) notFound();

  return (
    <main data-accent="violet" className="min-h-screen pb-24">
      <SiteHeader trailing={<OperatorNav current="/operator/hunts" />} />
      <div className="mx-auto max-w-4xl px-6 py-10">
        <a href="/operator/hunts" className="text-[13px] text-ink-400 hover:text-ink-200">&larr; All hunts</a>
        <HuntShortlist detail={detail} base="/operator/hunts" />
      </div>
    </main>
  );
}

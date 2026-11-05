import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/app/components/chrome";
import { SiteFooter } from "@/app/components/SiteFooter";
import { requireMandateManagement, viewerAccountId, viewerManagesAllMandates } from "@/app/operator/guard";
import { SignOutButton } from "@/app/operator/SignOutButton";
import { loadHuntDetail } from "@backend/dealHunt/read";
import { HuntShortlist } from "@/app/components/hunt/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deal Hunt — Lode" };

export default async function InvestorHuntDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireMandateManagement("/invest/hunts");
  const { id } = await params;
  const detail = await loadHuntDetail(id);
  // An investor sees only their own hunt; a manage-all account sees any.
  if (detail === undefined) notFound();
  if (!viewerManagesAllMandates(viewer) && detail.run.investorId !== viewerAccountId(viewer)) notFound();

  return (
    <main data-accent="violet" className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <>
            <Link href="/invest/hunts" className="text-[13px] text-ink-400 hover:text-ink-200">All hunts</Link>
            <SignOutButton />
          </>
        }
      />
      <div className="mx-auto max-w-4xl px-6 py-10">
        <a href="/invest/hunts" className="text-[13px] text-ink-400 hover:text-ink-200">&larr; All hunts</a>
        <HuntShortlist detail={detail} base="/invest/hunts" />
      </div>
      <SiteFooter />
    </main>
  );
}

import Link from "next/link";
import { SiteHeader } from "@/app/components/chrome";
import { requireListingImport, viewerAccountId, viewerImportsAll } from "@/app/operator/guard";
import { listImportedListings } from "@backend/store/repository";
import { ImportForm } from "@/app/operator/import/ImportForm";
import { ImportDraftList } from "@/app/operator/import/ImportDraftList";

export const dynamic = "force-dynamic";

export const metadata = { title: "My listings — Lode" };

/**
 * A partner's own listings: the self-service import for an agent or auctioneer.
 *
 * Same engine as the operator surface, scoped to this account. A partner sees
 * and may withdraw only listings they submitted — the row-level check in the
 * actions is what keeps that true, and this page shows only their own.
 */
export default async function MyListingsPage() {
  const viewer = await requireListingImport("/account/listings");
  const all = await listImportedListings();
  // A partner is scoped to their own; an operator landing here still sees all.
  const seesAll = viewerImportsAll(viewer);
  const mine = viewerAccountId(viewer);
  const drafts = all.filter((l) => l.status === "draft" && (seesAll || l.ownerAccountId === mine));

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        width="max-w-3xl"
        trailing={
          <Link href="/" className="text-xs text-ink-500 transition-colors hover:text-ink-100">
            Back to home
          </Link>
        }
      />

      <div className="mx-auto max-w-3xl px-6 py-10">
        <span className="eyebrow">My listings</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          Import your stock, in one step
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          Paste the link to a lot or a property you are instructed on, and we read its facts from the
          page&rsquo;s own structured data. We never take the photographs or the written description,
          and we do not import from the portals. What you import is private to your account.
        </p>

        <ImportForm />

        <section className="mt-12">
          <h2 className="eyebrow">
            {drafts.length === 0 ? "No drafts yet" : `${drafts.length} draft${drafts.length === 1 ? "" : "s"}`}
          </h2>
          <ImportDraftList drafts={drafts} scope="own" />
        </section>
      </div>
    </main>
  );
}

import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader } from "@/app/components/chrome";
import { requireListingImport, viewerAccountId, viewerImportsAll } from "@/app/operator/guard";
import { listImportedListings } from "@backend/store/repository";
import { ImportForm } from "./ImportForm";
import { ImportDraftList } from "./ImportDraftList";

export const dynamic = "force-dynamic";

export const metadata = { title: "Import a listing — Lode" };

/**
 * Import a listing from a link — the operator view, which sees every import.
 *
 * It finds the facts a publisher put in their own page's structured data and
 * saves a draft. It does not scrape the portals, it does not take the
 * photographs or the description, and it does not make a property live on its
 * own — a draft still runs the pipeline's appraisal and seller checks.
 */
export default async function ImportPage() {
  const viewer = await requireListingImport("/operator/import");
  const all = await listImportedListings();
  const seesAll = viewerImportsAll(viewer);
  const mine = viewerAccountId(viewer);
  const drafts = all.filter(
    (l) => l.status === "draft" && (seesAll || l.ownerAccountId === mine),
  );

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader trailing={<OperatorNav current="/operator/import" />} />

      <div className="mx-auto max-w-3xl px-6 py-10">
        <span className="eyebrow">Import a listing</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          Paste a link, publish the property
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          For a seller, an instructed agent or an auctioneer. Paste the link to a property you are
          entitled to publish and we read the facts from the page&rsquo;s own structured data — the
          address, the price, the type, the size. We do not take the photographs or the description,
          which are somebody&rsquo;s copyright, and we do not import from the portals, whose terms
          forbid it.
        </p>

        <ImportForm />

        <section className="mt-12">
          <h2 className="eyebrow">
            {drafts.length === 0
              ? "No imported drafts yet"
              : `${drafts.length} imported draft${drafts.length === 1 ? "" : "s"}`}
          </h2>
          <ImportDraftList drafts={drafts} scope={seesAll ? "all" : "own"} />
        </section>
      </div>
    </main>
  );
}

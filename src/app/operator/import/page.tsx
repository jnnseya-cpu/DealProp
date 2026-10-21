import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader } from "@/app/components/chrome";
import { requirePermission } from "@/app/operator/guard";
import { listImportedListings } from "@backend/store/repository";
import { categoryDefinition } from "@shared/domain/inventory";
import { ImportForm, WithdrawButton } from "./ImportForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Import a listing — Lode" };

/**
 * Import a listing from a link — the rights-holder's one-click path.
 *
 * It finds the facts a publisher put in their own page's structured data and
 * saves a draft. It does not scrape the portals, it does not take the
 * photographs or the description, and it does not make a property live on its
 * own — a draft still runs the pipeline's appraisal and seller checks before it
 * can be marketed. The honest claim is "the facts, in one click", not "the
 * whole listing, no questions asked".
 */
export default async function ImportPage() {
  await requirePermission("manage-mandates", "/operator/import");
  const all = await listImportedListings();
  const drafts = all.filter((l) => l.status === "draft");

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
          {drafts.length === 0 ? (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-400">
              A listing you import is saved here as a draft, with the category that follows from who
              submitted it, until it has been appraised and the seller checks are done.
            </p>
          ) : (
            <ul className="mt-4 space-y-4">
              {drafts.map((entry) => (
                <li key={entry.id} className="rounded-2xl border hairline bg-surface-1 px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <p className="font-display text-base text-ink-100">
                      {entry.listing.title ?? entry.listing.address ?? entry.listing.publisherHost}
                    </p>
                    <p className="font-mono text-xs text-ink-400">{entry.category}</p>
                  </div>
                  <dl className="mt-3 space-y-1 text-sm">
                    {entry.listing.postcode !== undefined && (
                      <Row k="Postcode" v={entry.listing.postcode} />
                    )}
                    {entry.listing.priceGbp !== undefined && (
                      <Row k="As listed" v={`£${entry.listing.priceGbp.toLocaleString("en-GB")}`} />
                    )}
                    <Row k="Confirmed by" v={entry.confirmedBy} />
                    <Row k="Warranted by" v={entry.warrantedBy} />
                  </dl>
                  <p className="mt-3 border-l-2 border-ink-700 pl-3 text-xs leading-relaxed text-ink-400">
                    {categoryDefinition(entry.category).disclosure}
                  </p>
                  <div className="mt-3 flex items-center gap-4">
                    <a
                      href={entry.listing.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-lode-300 underline underline-offset-2 hover:text-lode-200"
                    >
                      View the source listing
                    </a>
                    <WithdrawButton id={entry.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-wrap gap-x-3">
      <dt className="text-ink-500">{k}</dt>
      <dd className="text-ink-200">{v}</dd>
    </div>
  );
}

import { categoryDefinition } from "@shared/domain/inventory";
import type { StoredImportedListing } from "@backend/store/schema";
import { WithdrawButton } from "./ImportForm";

/**
 * The imported drafts, and what each still needs to go live.
 *
 * A draft is honest about being a draft. Importing facts does not make a
 * property marketable: going live needs our own independent valuation, the
 * seller due diligence the Money Laundering Regulations require, and the
 * material information a buyer is entitled to before marketing. The first of
 * those — the appraisal — is one click from here, pre-filled with the listed
 * price; the rest are work a person and the seller have to do, and saying so is
 * the difference between this and a portal.
 */

/** The appraisal hand-off: the listed price seeds the free appraisal. */
function appraiseHref(entry: StoredImportedListing): string | undefined {
  const price = entry.listing.priceGbp;
  if (price === undefined) return undefined;
  const params = new URLSearchParams({ marketValue: String(price) });
  return `/appraise?${params.toString()}`;
}

export function ImportDraftList({
  drafts,
  scope,
}: {
  drafts: readonly StoredImportedListing[];
  scope: "all" | "own";
}) {
  if (drafts.length === 0) {
    return (
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-400">
        {scope === "own"
          ? "A listing you import is saved here as a draft until it has been appraised and the checks are done."
          : "A listing imported by you or a partner is saved here as a draft, with the category that follows from who submitted it, until it has been appraised and the seller checks are done."}
      </p>
    );
  }

  return (
    <ul className="mt-4 space-y-4">
      {drafts.map((entry) => {
        const appraise = appraiseHref(entry);
        return (
          <li key={entry.id} className="rounded-2xl border hairline bg-surface-1 px-5 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <p className="font-display text-base text-ink-100">
                {entry.listing.title ?? entry.listing.address ?? entry.listing.publisherHost}
              </p>
              <p className="font-mono text-xs text-ink-400">{entry.category}</p>
            </div>

            <dl className="mt-3 space-y-1 text-sm">
              {entry.listing.postcode !== undefined && <Row k="Postcode" v={entry.listing.postcode} />}
              {entry.listing.priceGbp !== undefined && (
                <Row k="As listed" v={`£${entry.listing.priceGbp.toLocaleString("en-GB")}`} />
              )}
              <Row k="Confirmed by" v={entry.confirmedBy} />
              <Row k="Warranted by" v={entry.warrantedBy} />
            </dl>

            <p className="mt-3 border-l-2 border-ink-700 pl-3 text-xs leading-relaxed text-ink-400">
              {categoryDefinition(entry.category).disclosure}
            </p>

            <p className="mt-3 text-xs leading-relaxed text-ink-500">
              To go live it still needs: an independent valuation (not the asking price), the seller
              due diligence the regulations require, and the material information a buyer is entitled
              to. Start with the valuation —
              {appraise !== undefined ? " the listed price is carried across." : " add a price first."}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {appraise !== undefined && (
                <a
                  href={appraise}
                  className="inline-flex h-8 items-center rounded-md bg-lode-400 px-3 text-xs font-medium text-ink-950 transition-colors hover:bg-lode-300"
                >
                  Appraise this
                </a>
              )}
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
        );
      })}
    </ul>
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

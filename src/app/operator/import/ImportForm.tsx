"use client";

import { useActionState } from "react";
import { importListingAction, withdrawImportedListingAction, type ImportResult } from "./actions";
import { SUBMITTER_ROLES } from "@shared/domain/listingImport";

export function WithdrawButton({ id }: { id: string }) {
  const [, submit, pending] = useActionState<{ ok: boolean; message: string } | undefined, FormData>(
    withdrawImportedListingAction,
    undefined,
  );
  return (
    <form action={submit}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-8 items-center rounded-md border hairline bg-surface-2 px-3 text-xs text-ink-300 transition-colors hover:border-ink-600 hover:text-ink-100"
      >
        {pending ? "…" : "Withdraw"}
      </button>
    </form>
  );
}

/**
 * Import a listing from its link.
 *
 * One field, a declaration of who you are, and a warranty. The warranty is not
 * a formality: importing a listing publishes it, and we only publish what the
 * submitter is entitled to publish.
 */
export function ImportForm() {
  const [result, submit, pending] = useActionState<ImportResult | undefined, FormData>(
    importListingAction,
    undefined,
  );

  return (
    <>
      <form action={submit} className="mt-8 rounded-2xl border hairline bg-surface-1 px-5 py-5">
        <label className="block text-xs text-ink-500" htmlFor="url">
          Link to the listing (an auction lot, or your own site)
        </label>
        <input
          id="url"
          name="url"
          type="url"
          required
          placeholder="https://www.your-auction-house.co.uk/lot/1234"
          className="mt-1.5 h-10 w-full rounded-md border hairline bg-ink-950 px-3 text-sm text-ink-100"
        />

        <fieldset className="mt-5">
          <legend className="text-xs text-ink-500">Who are you in relation to this property?</legend>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {SUBMITTER_ROLES.map((role, i) => (
              <label key={role.value} className="flex items-center gap-2 text-sm text-ink-200">
                <input type="radio" name="role" value={role.value} required={i === 0} className="size-4" />
                {role.label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="mt-5 flex items-start gap-3 text-sm leading-relaxed text-ink-200">
          <input type="checkbox" name="warranty" value="yes" required className="mt-1 size-4 shrink-0" />
          <span>
            I have the right to publish this property on Lode, and to share the details being
            imported. I understand photographs and the written description are not imported.
          </span>
        </label>

        <button
          type="submit"
          disabled={pending}
          className="mt-5 inline-flex h-10 items-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300 disabled:opacity-60"
        >
          {pending ? "Reading the page…" : "Import from link"}
        </button>

        {result !== undefined && !result.ok && (
          <p className="mt-4 border-l-2 border-amber-400/70 pl-3 text-sm leading-relaxed text-amber-200" role="status">
            {result.message}
          </p>
        )}
      </form>

      {result?.ok === true && result.listing !== undefined && (
        <section className="mt-6 rounded-2xl border hairline bg-surface-1 px-5 py-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="eyebrow">Imported — saved as a draft</h2>
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-600">
              {result.listing.publisherHost}
            </span>
          </div>
          <dl className="mt-4 space-y-1.5 text-sm">
            {result.listing.title !== undefined && <Fact k="Title" v={result.listing.title} />}
            {result.listing.address !== undefined && <Fact k="Address" v={result.listing.address} />}
            {result.listing.postcode !== undefined && <Fact k="Postcode" v={result.listing.postcode} />}
            {result.listing.priceGbp !== undefined && (
              <Fact
                k="Price as listed"
                v={`£${result.listing.priceGbp.toLocaleString("en-GB")}${
                  result.listing.priceQualifier !== undefined ? ` (${result.listing.priceQualifier})` : ""
                } — a claim, not our valuation`}
              />
            )}
            {result.listing.propertyType !== undefined && <Fact k="Type" v={result.listing.propertyType} />}
            {result.listing.bedrooms !== undefined && <Fact k="Bedrooms" v={String(result.listing.bedrooms)} />}
            {result.listing.tenure !== undefined && <Fact k="Tenure" v={result.listing.tenure} />}
            {result.listing.floorAreaSqm !== undefined && (
              <Fact k="Floor area" v={`${result.listing.floorAreaSqm} m²`} />
            )}
          </dl>
          <p className="mt-4 border-l-2 border-ink-700 pl-3 text-xs leading-relaxed text-ink-400">
            Facts only — the photographs and the written description were not taken, because they are
            somebody&rsquo;s copyright. To go live it still needs our own appraisal and the seller
            checks the pipeline requires; importing facts does not make a property marketable on its
            own.
          </p>
        </section>
      )}
    </>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-wrap gap-x-3">
      <dt className="text-ink-500">{k}</dt>
      <dd className="text-ink-200">{v}</dd>
    </div>
  );
}

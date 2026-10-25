"use client";

import { useActionState } from "react";
import { Button } from "@/app/components/chrome";
import { removeDealPhoto, uploadDealPhoto, type PhotoResult } from "./photo-actions";

const INIT: PhotoResult = { ok: false };

/**
 * Property photos for one deal.
 *
 * Staff add, replace and remove the photos a buyer later sees on the
 * opportunity. The bytes are served by `/api/deal-image`; this renders the
 * current set from the positions the server passed and posts new ones to the
 * action. The deal id is a hidden field because staff act on any deal — the
 * action validates it and checks the permission itself.
 */
export function PropertyPhotos({
  dealId,
  positions,
}: {
  dealId: string;
  positions: readonly number[];
}) {
  const [uploaded, upload, uploading] = useActionState(uploadDealPhoto, INIT);
  const [removed, remove, removing] = useActionState(removeDealPhoto, INIT);
  const result = uploaded.message !== undefined ? uploaded : removed;

  return (
    <div>
      {positions.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {positions.map((position) => (
            <li key={position} className="group relative overflow-hidden rounded-lg border hairline">
              {/* The serving route re-checks permission; a plain img is fine. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/deal-image/${encodeURIComponent(dealId)}/${position}`}
                alt={`Property photo ${position + 1}`}
                className="aspect-[3/2] w-full object-cover"
              />
              <form action={remove} className="absolute right-1.5 top-1.5">
                <input type="hidden" name="dealId" value={dealId} />
                <input type="hidden" name="position" value={position} />
                <button
                  type="submit"
                  disabled={removing}
                  aria-label={`Remove photo ${position + 1}`}
                  className="rounded-md border border-ink-700 bg-ink-950/80 px-2 py-0.5 text-[11px] text-ink-300 opacity-0 transition hover:text-red-300 group-hover:opacity-100"
                >
                  {removing ? "…" : "Remove"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-400">
          No photos yet. Add a few and they appear on the opportunity card buyers browse.
        </p>
      )}

      <form action={upload} className="mt-4 flex flex-wrap items-center gap-3">
        <input type="hidden" name="dealId" value={dealId} />
        <input
          type="file"
          name="file"
          accept="image/png,image/jpeg,image/webp"
          required
          aria-label="Choose a property photo"
          className="max-w-full text-[13px] text-ink-300 file:mr-3 file:rounded-md file:border file:border-[color:var(--hairline,#2a2a2a)] file:bg-surface-2 file:px-3 file:py-1.5 file:text-[13px] file:text-ink-100 hover:file:bg-surface-3"
        />
        <Button type="submit" variant="primary" size="sm" disabled={uploading}>
          {uploading ? "Uploading…" : "Add photo"}
        </Button>
      </form>

      {result.message !== undefined && (
        <p className={`mt-2 text-[12px] ${result.ok ? "text-emerald-300" : "text-red-300"}`}>
          {result.message}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-snug text-ink-500">
        JPEG, PNG or WebP, up to 8 MB each. Resized and re-encoded on upload, which strips any
        location or camera data — a photo can never leak the address.
      </p>
    </div>
  );
}

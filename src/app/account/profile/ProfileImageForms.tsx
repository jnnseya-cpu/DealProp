"use client";

import { useActionState } from "react";
import { Button } from "@/app/components/chrome";
import { removeProfileImage, uploadProfileImage, type ActionResult } from "./actions";

const INIT: ActionResult = { ok: false };

/**
 * Upload / replace / remove one profile image.
 *
 * `useActionState` keeps the inline result without a page framework of its own:
 * the form posts the file to the server action, and the returned message —
 * success or the engine's own validation reason — is shown beneath it. The
 * account id is never in the form; the action reads it from the session.
 */
export function ImageUploader({
  kind,
  hasImage,
  label,
}: {
  kind: "avatar" | "cover";
  hasImage: boolean;
  label: string;
}) {
  const [state, upload, uploading] = useActionState(uploadProfileImage, INIT);
  const [removed, remove, removing] = useActionState(removeProfileImage, INIT);
  const result = state.message !== undefined ? state : removed;

  return (
    <div>
      <form action={upload} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="kind" value={kind} />
        <input
          type="file"
          name="file"
          accept="image/png,image/jpeg,image/webp"
          required
          aria-label={`Choose a ${label.toLowerCase()}`}
          className="max-w-full text-[13px] text-ink-300 file:mr-3 file:rounded-md file:border file:border-[color:var(--hairline,#2a2a2a)] file:bg-surface-2 file:px-3 file:py-1.5 file:text-[13px] file:text-ink-100 hover:file:bg-surface-3"
        />
        <Button type="submit" variant="primary" size="sm" disabled={uploading}>
          {uploading ? "Uploading…" : hasImage ? "Replace" : "Upload"}
        </Button>
        {hasImage && (
          <button
            type="submit"
            formAction={remove}
            disabled={removing}
            className="text-[13px] text-ink-400 underline-offset-2 hover:text-red-300 hover:underline"
          >
            {removing ? "Removing…" : "Remove"}
          </button>
        )}
      </form>
      {result.message !== undefined && (
        <p className={`mt-2 text-[12px] ${result.ok ? "text-emerald-300" : "text-red-300"}`}>
          {result.message}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-snug text-ink-500">
        JPEG, PNG or WebP, up to 8 MB. Images are resized and re-encoded on upload, which removes
        any location or camera data they carried.
      </p>
    </div>
  );
}

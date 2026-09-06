"use client";

import { useActionState } from "react";
import { recordConfirmationAction, type InventoryResult } from "./inventoryActions";
import { CATEGORIES } from "@shared/domain/inventory";

/**
 * Record who said the property is for sale.
 *
 * The category and the words they used go in together. They are separate
 * fields on the record so `categoryDefect()` can catch them disagreeing, and a
 * form that set one without the other would mostly be used to create exactly
 * that disagreement.
 */
export function InventoryForm({
  dealId,
  category,
  evidence,
}: {
  dealId: string;
  category?: string;
  evidence?: string;
}) {
  const [result, submit, pending] = useActionState<InventoryResult | undefined, FormData>(
    recordConfirmationAction,
    undefined,
  );

  return (
    <form action={submit}>
      <input type="hidden" name="dealId" value={dealId} />
      <label htmlFor="category" className="eyebrow">
        Who confirmed it is for sale
      </label>
      <select
        id="category"
        name="category"
        required
        defaultValue={category ?? ""}
        className="mt-2 w-full px-3 py-2"
      >
        <option value="" disabled>
          Choose
        </option>
        {CATEGORIES.map((c) => (
          <option key={c.category} value={c.category}>
            {c.label}
          </option>
        ))}
      </select>

      <label htmlFor="evidence" className="eyebrow mt-3 block">
        What they said
      </label>
      <textarea
        id="evidence"
        name="evidence"
        rows={3}
        defaultValue={evidence ?? ""}
        placeholder="Told us on the telephone she wants it sold by Christmas and is happy to be contacted."
        className="mt-2 w-full px-3 py-2"
      />
      <p className="mt-2 text-[12px] leading-[1.6] text-ink-500">
        Kept verbatim. A buyer pays for what this says, and if they are later told something
        different it is this record they will be shown. Not needed for AI-discovered, which is the
        one category that claims nobody said anything.
      </p>

      <button
        type="submit"
        disabled={pending}
        className="mt-3 inline-flex h-9 items-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300"
      >
        {pending ? "Recording…" : "Record the confirmation"}
      </button>
      {result !== undefined && (
        <p
          role="status"
          className={`mt-2.5 text-[13px] leading-[1.6] ${result.ok ? "text-emerald-300" : "text-amber-300"}`}
        >
          {result.message}
        </p>
      )}
    </form>
  );
}

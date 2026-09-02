"use client";

import { useActionState } from "react";
import { recordMaterialAction, type MaterialResult } from "./actions";

/**
 * One item, one form.
 *
 * The state is chosen rather than inferred from whether the field is empty.
 * An empty field means nobody has answered; "not known" means somebody asked
 * and could not find out. A form that collapsed the two would recreate the
 * omission the whole engine exists to prevent.
 */
export function MaterialForm({
  dealId,
  itemKey,
  alwaysApplies,
  current,
}: {
  dealId: string;
  itemKey: string;
  alwaysApplies: boolean;
  current?: { state: string; text: string };
}) {
  const [result, submit, pending] = useActionState<MaterialResult | undefined, FormData>(
    recordMaterialAction,
    undefined,
  );

  return (
    <form action={submit} className="mt-2.5 flex flex-wrap items-start gap-2">
      <input type="hidden" name="dealId" value={dealId} />
      <input type="hidden" name="key" value={itemKey} />
      <label className="sr-only" htmlFor={`state-${itemKey}`}>
        What is known
      </label>
      <select
        id={`state-${itemKey}`}
        name="state"
        required
        defaultValue={current?.state ?? ""}
        className="shrink-0 px-2 py-1.5 text-[13px]"
      >
        <option value="" disabled>
          What is known
        </option>
        <option value="stated">We know it</option>
        <option value="not-known">Asked, not known</option>
        {!alwaysApplies && <option value="not-applicable">Does not apply</option>}
      </select>
      <label className="sr-only" htmlFor={`text-${itemKey}`}>
        The answer, or who was asked
      </label>
      <input
        id={`text-${itemKey}`}
        name="text"
        required
        defaultValue={current?.text ?? ""}
        placeholder="The answer, who was asked, or why it does not apply"
        className="min-w-0 flex-1 px-3 py-1.5 text-[13px]"
      />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-8 shrink-0 items-center rounded-md border hairline bg-surface-2 px-3 text-[13px] text-ink-200 transition-colors hover:border-ink-600 hover:text-ink-100"
      >
        {pending ? "Saving…" : "Record"}
      </button>
      {result !== undefined && (
        <p
          role="status"
          className={`w-full text-[12px] leading-[1.5] ${result.ok ? "text-emerald-300" : "text-amber-300"}`}
        >
          {result.message}
        </p>
      )}
    </form>
  );
}

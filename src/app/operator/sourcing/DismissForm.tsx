"use client";

import { useActionState } from "react";
import { dismissSourcedPropertyAction } from "./actions";

/** Set one worklist property aside, with an optional reason. */
export function DismissForm({ id }: { id: string }) {
  const [result, submit, pending] = useActionState<{ ok: boolean; message: string } | undefined, FormData>(
    dismissSourcedPropertyAction,
    undefined,
  );

  return (
    <form action={submit} className="mt-3 flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input
        name="reason"
        placeholder="Reason (optional)"
        className="h-8 min-w-0 flex-1 rounded-md border hairline bg-ink-950 px-2 text-xs text-ink-200"
      />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-8 items-center rounded-md border hairline bg-surface-2 px-3 text-xs text-ink-300 transition-colors hover:border-ink-600 hover:text-ink-100"
      >
        {pending ? "…" : "Set aside"}
      </button>
      {result !== undefined && !result.ok && (
        <span className="text-xs text-amber-300">{result.message}</span>
      )}
    </form>
  );
}

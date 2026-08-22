"use client";

import { useActionState, useState } from "react";
import type { BoxFormResult } from "@/lib/formFields";
import type { CategoryDefinition } from "@/domain/jurisdictions/uk-financial-promotion";
import { certify } from "./actions";

/**
 * The certification form.
 *
 * One category at a time, with its statements shown in full. The statements are
 * not summarised: they are the words the person signs, and a shortened version
 * is not the declaration the exemption requires.
 */
export function CertifyForm({ categories }: { categories: readonly CategoryDefinition[] }) {
  const [state, formAction, pending] = useActionState<BoxFormResult | undefined, FormData>(
    certify,
    undefined,
  );
  const [selected, setSelected] = useState(categories[0]?.category ?? "");
  const current = categories.find((c) => c.category === selected);

  if (state?.ok === true) {
    return (
      <div role="status" className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-6 py-6">
        <p className="font-display text-xl text-emerald-200">Recorded</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-300">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      <fieldset>
        <legend className="text-sm text-ink-200">Which describes you?</legend>
        <div className="mt-3 space-y-2">
          {categories.map((c) => (
            <label
              key={c.category}
              className="flex cursor-pointer items-start gap-3 rounded-xl border hairline bg-ink-900/40 px-4 py-3 transition hover:border-lode-500/40"
            >
              <input
                type="radio"
                name="category"
                value={c.category}
                checked={selected === c.category}
                onChange={() => setSelected(c.category)}
                className="mt-1 h-4 w-4 accent-lode-400"
              />
              <span>
                <span className="block text-sm text-ink-100">{c.label}</span>
                <span className="block text-xs text-ink-500">{c.citation}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {current !== undefined && (
        <fieldset>
          <legend className="text-sm text-ink-200">
            Tick every statement that is true of you
          </legend>
          <p className="mt-0.5 text-xs text-ink-500">
            At least one must be true. These are the words you are signing.
          </p>
          <div className="mt-3 space-y-2">
            {current.criteria.map((criterion) => (
              <label
                key={criterion.key}
                className="flex cursor-pointer items-start gap-3 rounded-xl border hairline bg-ink-900/40 px-4 py-3 text-sm leading-relaxed text-ink-300 transition hover:border-lode-500/40"
              >
                <input
                  type="checkbox"
                  name={`criterion-${criterion.key}`}
                  className="mt-1 h-4 w-4 shrink-0 accent-lode-400"
                />
                {criterion.text}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {state?.ok === false && (
        <p role="alert" className="text-sm text-red-300">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-lode-400 px-5 py-3 text-sm font-medium text-ink-950 transition hover:bg-lode-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Recording…" : "Sign this statement"}
      </button>
    </form>
  );
}

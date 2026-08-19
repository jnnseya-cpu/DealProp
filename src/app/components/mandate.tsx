"use client";

import { useActionState, useState } from "react";
import type { BoxFormResult } from "@/lib/formFields";

/**
 * Mandate form primitives.
 *
 * Both marketplaces ask the same shapes of question — a name, a set of
 * jurisdictions, a money range, a percentage, a handful of yes/no terms — so
 * the inputs are defined once. Two pages that each grew their own text field is
 * how a form ends up with two different focus rings and one missing label.
 */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm text-ink-200">{label}</span>
      {hint !== undefined && <span className="mt-0.5 block text-xs text-ink-500">{hint}</span>}
      <div className="mt-2">{children}</div>
    </label>
  );
}

const INPUT =
  "w-full rounded-xl border hairline bg-ink-900/60 px-4 py-2.5 text-sm text-ink-100 placeholder:text-ink-500 focus:border-lode-500/60 focus:outline-none";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={INPUT} />;
}

export function Select({
  options,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: readonly { value: string; label: string }[];
}) {
  return (
    <select {...props} className={INPUT}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * A multi-select rendered as checkboxes.
 *
 * A native multiple-select is close to unusable on a phone and gives no
 * indication that more than one option is allowed.
 */
export function CheckGroup({
  name,
  options,
  defaultValues = [],
  columns = 2,
}: {
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValues?: readonly string[];
  columns?: number;
}) {
  const chosen = new Set(defaultValues);
  return (
    <div className={`grid gap-2 ${columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
      {options.map((o) => (
        <label
          key={o.value}
          className="flex cursor-pointer items-center gap-2.5 rounded-xl border hairline bg-ink-900/40 px-3.5 py-2.5 text-sm text-ink-200 transition hover:border-lode-500/40"
        >
          <input
            type="checkbox"
            name={name}
            value={o.value}
            defaultChecked={chosen.has(o.value)}
            className="h-4 w-4 accent-lode-400"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function Toggle({
  name,
  label,
  defaultChecked = false,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-200">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 accent-lode-400"
      />
      {label}
    </label>
  );
}

/**
 * The form shell: submit state, the server's message, and a disclosure that
 * collapses the whole thing when it is not being used.
 */
export function MandateForm({
  action,
  title,
  summary,
  children,
  openByDefault = false,
}: {
  action: (previous: BoxFormResult | undefined, formData: FormData) => Promise<BoxFormResult>;
  title: string;
  summary: string;
  children: React.ReactNode;
  openByDefault?: boolean;
}) {
  const [state, formAction, pending] = useActionState<BoxFormResult | undefined, FormData>(
    action,
    undefined,
  );
  const [open, setOpen] = useState(openByDefault);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl border border-dashed border-ink-700 px-6 py-5 text-left transition hover:border-lode-400/50"
      >
        <span className="font-display text-lg text-ink-100">{title}</span>
        <span className="mt-1 block text-sm text-ink-400">{summary}</span>
      </button>
    );
  }

  return (
    <form action={formAction} className="rounded-2xl border hairline bg-ink-900/40 px-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl text-ink-100">{title}</h2>
          <p className="mt-1 text-sm text-ink-400">{summary}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border hairline px-3 py-1.5 text-xs text-ink-400 transition hover:text-ink-100"
        >
          Close
        </button>
      </div>

      <div className="mt-6 space-y-5">{children}</div>

      {state !== undefined && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`mt-5 text-sm ${state.ok ? "text-emerald-300" : "text-red-300"}`}
        >
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-6 rounded-xl bg-lode-400 px-5 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-lode-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save mandate"}
      </button>
    </form>
  );
}

/**
 * Activate, deactivate and delete.
 *
 * Deactivating is offered first and deletion asks for confirmation, because a
 * mandate is somebody else's criteria and the count it feeds is shown to
 * sellers — an accidental deletion silently reduces the buyers a seller is told
 * about, with nothing to indicate anything was lost.
 */
export function MandateControls({
  id,
  active,
  setActive,
  remove,
}: {
  id: string;
  active: boolean;
  setActive: (id: string, active: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void setActive(id, !active).finally(() => setBusy(false));
        }}
        className="rounded-lg border hairline px-3 py-1.5 text-xs text-ink-300 transition hover:border-lode-400/40 hover:text-lode-200 disabled:opacity-50"
      >
        {active ? "Deactivate" : "Activate"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (!window.confirm("Delete this mandate? Deactivating keeps the criteria.")) return;
          setBusy(true);
          void remove(id).finally(() => setBusy(false));
        }}
        className="rounded-lg border border-red-500/25 px-3 py-1.5 text-xs text-red-300/80 transition hover:border-red-500/50 hover:text-red-200 disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  );
}

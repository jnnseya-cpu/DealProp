"use client";

import { useActionState } from "react";
import { requestPasswordReset } from "../reset/actions";
import type { BoxFormResult } from "@shared/formFields";

/** Request a reset link. Enumeration-safe: the message is the same either way. */
export function ForgotForm() {
  const [result, submit, pending] = useActionState<BoxFormResult | undefined, FormData>(
    requestPasswordReset,
    undefined,
  );

  return (
    <form action={submit} className="space-y-5">
      <div>
        <label htmlFor="email" className="block text-sm text-ink-200">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          aria-describedby={result !== undefined ? "forgot-result" : undefined}
          className="mt-2 w-full rounded-xl border hairline bg-surface-2 px-4 py-3 text-sm text-ink-100 focus:border-lode-500/60 focus:outline-none"
        />
      </div>

      {result !== undefined && (
        <p
          id="forgot-result"
          role="status"
          className={`text-sm leading-relaxed ${result.ok ? "text-ink-300" : "text-red-300"}`}
        >
          {result.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full inline-flex h-9.5 items-center justify-center gap-2 rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300 active:bg-lode-500 disabled:opacity-60"
      >
        {pending ? "Sending…" : "Email me a reset link"}
      </button>
    </form>
  );
}

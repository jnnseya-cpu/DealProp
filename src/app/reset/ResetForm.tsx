"use client";

import { useActionState } from "react";
import { completePasswordReset } from "./actions";
import type { BoxFormResult } from "@shared/formFields";

/**
 * Set a new password from a reset link.
 *
 * The token and address come from the emailed link (hidden fields); the server
 * re-checks both, so a tampered link simply fails the token check rather than
 * resetting anyone else's password.
 */
export function ResetForm({ token, email }: { token: string; email: string }) {
  const [result, submit, pending] = useActionState<BoxFormResult | undefined, FormData>(
    completePasswordReset,
    undefined,
  );

  return (
    <form action={submit} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="email" value={email} />

      <div>
        <label htmlFor="password" className="block text-sm text-ink-200">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          autoFocus
          aria-describedby={result !== undefined && !result.ok ? "reset-error" : "reset-hint"}
          aria-invalid={result !== undefined && !result.ok}
          className="mt-2 w-full rounded-xl border hairline bg-surface-2 px-4 py-3 text-sm text-ink-100 focus:border-lode-500/60 focus:outline-none"
        />
        <p id="reset-hint" className="mt-1.5 text-xs text-ink-500">
          At least 12 characters. Length matters more than symbols.
        </p>
      </div>

      {result !== undefined && !result.ok && (
        <p id="reset-error" role="alert" className="text-sm text-red-300">
          {result.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || token === "" || email === ""}
        className="w-full inline-flex h-9.5 items-center justify-center gap-2 rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300 active:bg-lode-500 disabled:opacity-60"
      >
        {pending ? "Setting your password…" : "Set new password"}
      </button>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { verifyEmailCode } from "../actions";
import type { BoxFormResult } from "@shared/formFields";

/**
 * The code-entry form shown straight after sign-up.
 *
 * The address is carried in a hidden field from the sign-up redirect so it is
 * not retyped; the server reads and re-checks it. The code input is six digits,
 * numeric, and uses a one-time-code autocomplete so a phone can offer the code
 * from the email automatically.
 */
export function VerifyForm({ email }: { email: string }) {
  const [result, submit, pending] = useActionState<BoxFormResult | undefined, FormData>(
    verifyEmailCode,
    undefined,
  );

  return (
    <form action={submit} className="space-y-5">
      <input type="hidden" name="email" value={email} />

      <div>
        <label htmlFor="code" className="block text-sm text-ink-200">
          Verification code
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          autoFocus
          aria-describedby={result !== undefined && !result.ok ? "verify-error" : "verify-hint"}
          aria-invalid={result !== undefined && !result.ok}
          className="tnum mt-2 w-full rounded-xl border hairline bg-surface-2 px-4 py-3 text-center text-lg tracking-[0.5em] text-ink-100 focus:border-lode-500/60 focus:outline-none"
        />
        <p id="verify-hint" className="mt-1.5 text-xs text-ink-500">
          We emailed a six-digit code to {email || "your address"}. It expires in 30 minutes.
        </p>
      </div>

      {result !== undefined && !result.ok && (
        <p id="verify-error" role="alert" className="text-sm text-red-300">
          {result.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full inline-flex h-9.5 items-center justify-center gap-2 rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300 active:bg-lode-500 disabled:opacity-60"
      >
        {pending ? "Verifying…" : "Verify and continue"}
      </button>
    </form>
  );
}

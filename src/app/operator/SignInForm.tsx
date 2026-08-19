"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

/**
 * Operator sign-in form.
 *
 * A single shared password, described as one. Calling it "sign in" without
 * saying so would imply per-person accounts and an audit trail that do not
 * exist yet.
 */
export function SignInForm({ next }: { next: string }) {
  const [error, formAction, pending] = useActionState<string | undefined, FormData>(
    signIn,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="next" value={next} />

      <div>
        <label htmlFor="password" className="block text-sm text-ink-200">
          Operator password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          aria-describedby={error !== undefined ? "operator-error" : undefined}
          aria-invalid={error !== undefined}
          className="mt-2 w-full rounded-xl border hairline bg-ink-900/60 px-4 py-3 text-sm text-ink-100 focus:border-lode-500/60 focus:outline-none"
        />
      </div>

      {error !== undefined && (
        <p id="operator-error" role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-lode-400 px-5 py-3 text-sm font-medium text-ink-950 transition hover:bg-lode-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

/**
 * Sign-in form.
 *
 * Two ways in, and the page says which is which. A named account gives a
 * person the audit trail can name; the shared password gives access with no
 * attribution, and is kept because it is what creates the first account and
 * what a solo operator uses before there are any.
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
        <label htmlFor="email" className="block text-sm text-ink-200">
          Email
        </label>
        <p className="mt-0.5 text-xs text-ink-500">
          Leave empty to use the shared operator password instead.
        </p>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          className="mt-2 w-full rounded-xl border hairline bg-surface-2 px-4 py-3 text-sm text-ink-100 focus:border-lode-500/60 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm text-ink-200">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          aria-describedby={error !== undefined ? "operator-error" : undefined}
          aria-invalid={error !== undefined}
          className="mt-2 w-full rounded-xl border hairline bg-surface-2 px-4 py-3 text-sm text-ink-100 focus:border-lode-500/60 focus:outline-none"
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
        className="w-full inline-flex h-9.5 items-center justify-center gap-2 rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300 active:bg-lode-500"
      >
        {pending ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

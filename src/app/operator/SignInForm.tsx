"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn } from "./actions";

/**
 * Sign-in form, in two clearly separate modes.
 *
 * `account` is the normal panel everyone uses: an email and a password for a
 * named account. `operator` is the admin entrance — the shared operator
 * password, no email, no attribution — reached by a quiet link beneath the
 * normal panel rather than presented to every visitor. The server action is the
 * same (`signIn`); an empty email means "use the shared password", which is why
 * the operator panel simply omits the email field.
 */
export function SignInForm({
  next,
  mode,
}: {
  next: string;
  mode: "account" | "operator";
}) {
  const [error, formAction, pending] = useActionState<string | undefined, FormData>(
    signIn,
    undefined,
  );

  const operator = mode === "operator";
  const otherHref = operator
    ? `/operator?next=${encodeURIComponent(next)}`
    : `/operator?mode=operator&next=${encodeURIComponent(next)}`;

  return (
    <div>
      <form action={formAction} className="space-y-5">
        <input type="hidden" name="next" value={next} />

        {!operator && (
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
              className="mt-2 w-full rounded-xl border hairline bg-surface-2 px-4 py-3 text-sm text-ink-100 focus:border-lode-500/60 focus:outline-none"
            />
          </div>
        )}

        <div>
          <label htmlFor="password" className="block text-sm text-ink-200">
            {operator ? "Operator secret" : "Password"}
          </label>
          {operator && (
            <p className="mt-0.5 text-xs text-ink-500">
              The shared operator password. Access with no personal attribution — use a named
              admin account for anything that should be in the audit trail.
            </p>
          )}
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete={operator ? "off" : "current-password"}
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
          {pending ? "Checking…" : operator ? "Enter operator panel" : "Sign in"}
        </button>
      </form>

      {!operator && (
        <p className="mt-6 text-center text-xs text-ink-400">
          New to Lode?{" "}
          <Link href="/join" className="text-lode-300 underline-offset-2 hover:underline">
            Create an account
          </Link>
        </p>
      )}

      <div className="mt-4 border-t hairline pt-4 text-center">
        <Link href={otherHref} className="text-xs text-ink-400 transition-colors hover:text-lode-300">
          {operator ? "← Back to account sign-in" : "Operator & admin sign-in →"}
        </Link>
      </div>
    </div>
  );
}

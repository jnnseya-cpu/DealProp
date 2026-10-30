"use client";

import { useActionState, useState } from "react";
import { register } from "./actions";
import type { BoxFormResult } from "@shared/formFields";
import type { Role } from "@shared/domain/accounts";

/**
 * The sign-up form, with the role chosen as a plain-English "I am a…".
 *
 * Only the four self-service roles are offered; the server validates the choice
 * again against the same set, so the radio is a convenience, not the control.
 * Each option says what the account is for in one line, because "funder" and
 * "partner" are our words, not the visitor's.
 */
/** The form's choices. `value` is what the server reads; "flipper" is a buyer + seller. */
const OPTIONS: readonly { readonly value: string; readonly label: string; readonly blurb: string }[] = [
  { value: "seller", label: "I'm selling a property", blurb: "Get a fair cash offer. Selling to us is free — no agent, no fees." },
  { value: "investor", label: "I'm a buyer / investor", blurb: "See graded opportunities and track your readiness. Deal material unlocks once you certify." },
  { value: "flipper", label: "I flip or source property", blurb: "Buy and sell on, or source a deal and assign it for a margin without buying. One account, buyer and seller." },
];

export function JoinForm({ defaultRole }: { defaultRole?: Role }) {
  const [result, submit, pending] = useActionState<BoxFormResult | undefined, FormData>(
    register,
    undefined,
  );
  const [role, setRole] = useState<string>(defaultRole ?? "seller");

  return (
    <form action={submit} className="space-y-5">
      <fieldset>
        <legend className="block text-sm text-ink-200">I am a…</legend>
        <div className="mt-2 space-y-2">
          {OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${
                role === opt.value ? "border-lode-500/60 bg-surface-2" : "hairline bg-surface-2/40 hover:bg-surface-2"
              }`}
            >
              <input
                type="radio"
                name="role"
                value={opt.value}
                checked={role === opt.value}
                onChange={() => setRole(opt.value)}
                className="mt-0.5 accent-lode-400"
              />
              <span>
                <span className="block text-sm text-ink-100">{opt.label}</span>
                <span className="mt-0.5 block text-xs leading-snug text-ink-400">{opt.blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="name" className="block text-sm text-ink-200">
          Name
        </label>
        <input
          id="name"
          name="name"
          autoComplete="name"
          required
          className="mt-2 w-full rounded-xl border hairline bg-surface-2 px-4 py-3 text-sm text-ink-100 focus:border-lode-500/60 focus:outline-none"
        />
      </div>

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

      <div>
        <label htmlFor="password" className="block text-sm text-ink-200">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          aria-describedby={result !== undefined && !result.ok ? "join-error" : "join-hint"}
          aria-invalid={result !== undefined && !result.ok}
          className="mt-2 w-full rounded-xl border hairline bg-surface-2 px-4 py-3 text-sm text-ink-100 focus:border-lode-500/60 focus:outline-none"
        />
        <p id="join-hint" className="mt-1.5 text-xs text-ink-500">
          At least 12 characters. Length matters more than symbols.
        </p>
      </div>

      {result !== undefined && !result.ok && (
        <p id="join-error" role="alert" className="text-sm text-red-300">
          {result.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full inline-flex h-9.5 items-center justify-center gap-2 rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300 active:bg-lode-500 disabled:opacity-60"
      >
        {pending ? "Creating your account…" : "Create account"}
      </button>

      <p className="text-xs leading-relaxed text-ink-500">
        By creating an account you agree to our{" "}
        <a href="/legal/terms" className="underline underline-offset-2 hover:text-ink-300">terms</a>{" "}
        and{" "}
        <a href="/legal/privacy" className="underline underline-offset-2 hover:text-ink-300">privacy notice</a>.
      </p>
    </form>
  );
}

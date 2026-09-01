"use client";

import { useActionState } from "react";
import { CONSENT_TEXT } from "@shared/domain/newsletter";
import { subscribe, type SubscribeResult } from "./actions";
import { track } from "@/app/components/Analytics";

/**
 * Subscribe form.
 *
 * The consent checkbox is unticked by default and the submit button does not
 * work without it — pre-ticked consent is not consent, and a form that opts
 * someone in by default is the exact pattern PECR exists to stop.
 */
export function SubscribeForm() {
  const [state, formAction, pending] = useActionState<SubscribeResult | undefined, FormData>(
    subscribe,
    undefined,
  );

  if (state?.ok === true) {
    return (
      <div
        role="status"
        className="rounded-lg border-l-2 border-emerald-500/80 bg-surface-1 px-5 py-4"
      >
        <p className="font-display text-[17px] leading-tight text-emerald-200">Almost there</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-300">{state.message}</p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={() => {
        // The address itself never travels. Only that a signup was attempted.
        track("newsletter_signup_submitted");
      }}
      className="space-y-6"
    >
      <div>
        <label htmlFor="email" className="block text-sm text-ink-200">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          aria-describedby={state?.ok === false ? "subscribe-error" : undefined}
          aria-invalid={state?.ok === false}
          className="mt-2 w-full rounded-xl border hairline bg-surface-2 px-4 py-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-lode-500/60 focus:outline-none"
        />
      </div>

      <fieldset>
        <legend className="text-sm text-ink-200">What brings you here?</legend>
        <p className="mt-0.5 text-xs text-ink-500">
          We send the sections relevant to you rather than everything.
        </p>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {[
            { value: "investor", label: "I buy property", hint: "Deals, structuring, stress tests" },
            { value: "funder", label: "I fund deals", hint: "Mandate matching, underwriting" },
            { value: "professional", label: "I work on transactions", hint: "Solicitor, broker, surveyor" },
            { value: "curious", label: "Just interested", hint: "How the platform works" },
          ].map((o, i) => (
            <label
              key={o.value}
              className="cursor-pointer rounded-xl border hairline bg-surface-1 px-4 py-3 transition hover:border-ink-400 has-[:checked]:border-lode-500/60 has-[:checked]:bg-lode-400/10"
            >
              <input
                type="radio"
                name="audience"
                value={o.value}
                defaultChecked={i === 0}
                className="sr-only"
              />
              <span className="block text-sm text-ink-100">{o.label}</span>
              <span className="mt-0.5 block text-xs text-ink-400">{o.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Honeypot. Hidden from people, irresistible to bots. */}
      <div aria-hidden className="absolute left-[-9999px]">
        <label htmlFor="website">Leave this empty</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <label className="flex cursor-pointer gap-3 rounded-xl border hairline bg-surface-1 px-5 py-4">
        <input
          type="checkbox"
          name="consent"
          required
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-lode-400)]"
        />
        <span className="text-xs leading-relaxed text-ink-300">{CONSENT_TEXT}</span>
      </label>

      {state?.ok === false && (
        <p id="subscribe-error" role="alert" className="text-sm text-red-300">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-9.5 items-center justify-center gap-2 rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300 active:bg-lode-500"
      >
        {pending ? "Sending confirmation…" : "Subscribe"}
      </button>
    </form>
  );
}

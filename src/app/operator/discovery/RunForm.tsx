"use client";

import { useActionState } from "react";
import { runDiscoveryAction, type CandidateResult } from "./actions";

/**
 * Start a discovery run.
 *
 * A list of organisations, not a search box. Nothing here crawls: no source is
 * licensed for harvesting the web for firms, so the operator names who to
 * check and the run confirms each against the official records and reads what
 * that organisation published about itself.
 */
export function RunForm() {
  const [result, submit, running] = useActionState<CandidateResult | undefined, FormData>(
    runDiscoveryAction,
    undefined,
  );

  return (
    <form action={submit} className="mt-10 rounded-2xl border hairline bg-ink-900/40 px-6 py-6">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">
        Run discovery
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-400">
        One organisation per line:{" "}
        <span className="font-mono text-ink-300">Name, domain, company number, FRN</span>. The last
        two are optional but without a company number nothing can be confirmed against the register,
        and an unconfirmed candidate cannot be approved.
      </p>

      <label className="sr-only" htmlFor="targets">
        Organisations to check
      </label>
      <textarea
        id="targets"
        name="targets"
        rows={5}
        required
        placeholder={"Example Bridging Limited, examplebridging.co.uk, 01234567, 123456\nAnother Lender Ltd, anotherlender.com, 07654321"}
        className="mt-4 w-full rounded-xl border hairline bg-ink-950 px-3 py-2 font-mono text-xs leading-relaxed text-ink-100"
      />

      <button
        type="submit"
        disabled={running}
        className="mt-4 rounded-xl border border-lode-400/50 px-5 py-2.5 text-sm text-lode-200 transition hover:border-lode-400 hover:bg-lode-400/10 disabled:opacity-50"
      >
        {running ? "Checking…" : "Run discovery"}
      </button>

      {result !== undefined && (
        <p
          className={`mt-4 text-sm leading-relaxed ${result.ok ? "text-emerald-300" : "text-amber-300"}`}
          role="status"
        >
          {result.message}
        </p>
      )}
    </form>
  );
}

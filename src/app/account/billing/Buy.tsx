"use client";

import { useState } from "react";

/**
 * Buy a plan or a top-up.
 *
 * The request names what is being bought and nothing else. There is no amount
 * in the payload, so there is nothing here for anybody to change — the price is
 * decided on the server from the catalogue, and the button only says which item.
 */
export function Buy({
  label,
  price,
  body,
}: {
  label: string;
  price: string;
  body: Record<string, string>;
}) {
  const [state, setState] = useState<{ pending: boolean; message?: string }>({ pending: false });

  async function buy(): Promise<void> {
    setState({ pending: true });
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { redirectUrl?: string; reason?: string };

      if (response.ok && typeof result.redirectUrl === "string") {
        window.location.href = result.redirectUrl;
        return;
      }
      setState({ pending: false, message: result.reason ?? `Could not start checkout (${response.status}).` });
    } catch {
      setState({ pending: false, message: "Could not reach the server." });
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void buy()}
        disabled={state.pending}
        className="w-full rounded-xl border border-lode-400/50 px-5 py-2.5 text-sm text-lode-200 transition hover:border-lode-400 hover:bg-lode-400/10 disabled:opacity-50"
      >
        {state.pending ? "Starting…" : `${label} — ${price}`}
      </button>
      {state.message !== undefined && (
        <p className="mt-2 text-xs leading-relaxed text-amber-300" role="status">
          {state.message}
        </p>
      )}
    </div>
  );
}

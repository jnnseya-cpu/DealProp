"use client";

import { useEffect, useState } from "react";
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  CONSENT_TEXT,
  parseConsent,
  type ConsentState,
} from "@shared/consent";

/**
 * The consent banner.
 *
 * Decline is a button of equal weight to accept, not a link in the small print.
 * A choice where one option is a primary button and the other is grey text is
 * not a free choice, and the ICO has said so repeatedly.
 *
 * Nothing loads until a choice is made. There is no "by continuing to browse"
 * — implied consent has not been lawful in the UK for years.
 */
export function ConsentBanner({ onChange }: { onChange: (state: ConsentState) => void }) {
  const [state, setState] = useState<ConsentState>("unknown");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raw = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${CONSENT_COOKIE}=`))
      ?.split("=")[1];
    const stored = parseConsent(raw);
    setState(stored);
    setReady(true);
    onChange(stored);
  }, [onChange]);

  function choose(next: "granted" | "denied"): void {
    // Not HttpOnly: the loader is client-side and must read it. It carries no
    // credential — only whether a choice was made — so there is nothing in it
    // worth stealing.
    document.cookie = `${CONSENT_COOKIE}=${next}; path=/; max-age=${CONSENT_MAX_AGE_SECONDS}; samesite=lax${
      window.location.protocol === "https:" ? "; secure" : ""
    }`;
    setState(next);
    onChange(next);
  }

  if (!ready || state !== "unknown") return null;

  return (
    <div
      role="dialog"
      aria-label="Cookies"
      className="app-safe-bottom fixed inset-x-0 bottom-0 z-50 border-t hairline bg-ink-950/95 px-5 py-4 backdrop-blur"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm leading-relaxed text-ink-300">{CONSENT_TEXT}</p>
        <div className="flex shrink-0 gap-3">
          <button
            type="button"
            onClick={() => choose("denied")}
            className="inline-flex h-9.5 items-center justify-center gap-2 rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-100 transition-colors hover:border-ink-600 hover:bg-surface-3"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => choose("granted")}
            className="inline-flex h-9.5 items-center justify-center gap-2 rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-100 transition-colors hover:border-ink-600 hover:bg-surface-3"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

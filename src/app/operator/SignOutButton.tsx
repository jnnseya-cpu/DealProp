"use client";

import { useActionState } from "react";
import { signOut } from "./actions";

/**
 * Sign out, shown wherever an operator surface is being viewed.
 *
 * A session with no way to end it is one that stays open on a shared or
 * borrowed machine, which is the ordinary way this kind of access leaks.
 */
export function SignOutButton() {
  const [, formAction, pending] = useActionState(async () => {
    await signOut();
  }, undefined);

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border hairline px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400 transition hover:border-lode-400/40 hover:text-lode-200 disabled:opacity-50"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </form>
  );
}

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
        className="rounded-md px-2 py-1 text-[13px] text-ink-400 transition-colors hover:text-ink-100"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </form>
  );
}

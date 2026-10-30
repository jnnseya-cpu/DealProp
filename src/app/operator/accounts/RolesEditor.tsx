"use client";

import { useActionState } from "react";
import { adminAllocatableRoles, isReservedRole, ROLE_LABELS, type Role } from "@shared/domain/accounts";
import type { BoxFormResult } from "@shared/formFields";
import { setAccountRoles } from "./actions";

/**
 * Allocate an account's roles — the admin power self-service lacks.
 *
 * This is how one person keeps one account while being several things: a seller
 * who starts buying, or a firm Lode has vetted into an estate agent, has the
 * role added here rather than opening a second account. Staff roles appear only
 * to an admin who may grant them; the vetted roles (estate agent, lender) appear
 * to every operator, because allocating them is exactly this surface's job.
 */
export function RolesEditor({
  id,
  roles,
  connectedParty,
  canGrantStaff,
}: {
  id: string;
  roles: readonly Role[];
  connectedParty: boolean;
  canGrantStaff: boolean;
}) {
  const [result, submit, pending] = useActionState<BoxFormResult | undefined, FormData>(
    setAccountRoles,
    undefined,
  );
  const options = adminAllocatableRoles().filter(
    (r) => (r !== "admin" && r !== "operator") || canGrantStaff,
  );
  // Reserved roles the account already holds are shown but never editable here —
  // an admin cannot grant or revoke a verified estate-agent or lender status.
  const heldReserved = roles.filter(isReservedRole);

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-[13px] text-ink-400 transition-colors hover:text-ink-200">
        Allocate roles
      </summary>
      <p className="mt-2 text-[11px] text-ink-500">Up to three roles per account.</p>
      <form action={submit} className="mt-3 space-y-3 rounded-lg border hairline bg-surface-2 px-4 py-3">
        <input type="hidden" name="id" value={id} />
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {options.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm text-ink-200">
              <input
                type="checkbox"
                name="roles"
                value={r}
                defaultChecked={roles.includes(r)}
                className="h-4 w-4 accent-lode-400"
              />
              {ROLE_LABELS[r]}
            </label>
          ))}
        </div>
        {heldReserved.length > 0 && (
          <p className="text-[12px] leading-relaxed text-ink-500">
            Verified, not editable here:{" "}
            <span className="text-ink-300">{heldReserved.map((r) => ROLE_LABELS[r]).join(", ")}</span>.
            Estate agent and lender status is set by verified onboarding, never allocated.
          </p>
        )}
        <label className="flex items-center gap-2 text-sm text-ink-200">
          <input
            type="checkbox"
            name="connectedParty"
            defaultChecked={connectedParty}
            className="h-4 w-4 accent-lode-400"
          />
          Lode / connected party
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-8 items-center rounded-md border hairline bg-surface-1 px-3 text-[13px] text-ink-100 transition-colors hover:border-ink-600 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save roles"}
          </button>
          {result !== undefined && (
            <span className={`text-xs ${result.ok ? "text-emerald-300" : "text-amber-300"}`}>
              {result.message}
            </span>
          )}
        </div>
      </form>
    </details>
  );
}

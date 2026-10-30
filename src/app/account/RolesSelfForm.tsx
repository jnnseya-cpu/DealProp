"use client";

import { useActionState } from "react";
import { SELF_SERVICE_ROLES, isReservedRole, ROLE_LABELS, type Role } from "@shared/domain/accounts";
import { setOwnRoles } from "./actions";

/**
 * "What you do on Lode" — a person's own control over their roles.
 *
 * The free, independent path: a seller who decides to also buy, or a buyer who
 * wants to flip, turns it on here themselves, on their one account, without an
 * admin. Only the self-service roles are offered. Any staff or reserved role the
 * account holds is shown read-only — it is never self-granted or self-removed —
 * so the control is honest about what a person may and may not change.
 */
const SELF_LABEL: Partial<Record<Role, string>> = {
  seller: "Seller — I have property to sell",
  investor: "Buyer / investor — I acquire property",
};

export function RolesSelfForm({ roles }: { roles: readonly Role[] }) {
  const [result, submit, pending] = useActionState<
    { ok: boolean; message: string } | undefined,
    FormData
  >(setOwnRoles, undefined);

  const held = new Set(roles);
  const fixed = roles.filter((r) => !SELF_SERVICE_ROLES.includes(r));

  return (
    <form action={submit} className="space-y-3">
      <p className="text-[13px] leading-relaxed text-ink-300">
        Turn on everything you do — a flipper is simply both. Change it whenever you like.
      </p>
      <div className="flex flex-col gap-2">
        {SELF_SERVICE_ROLES.map((r) => (
          <label key={r} className="flex items-center gap-2.5 text-sm text-ink-200">
            <input
              type="checkbox"
              name="roles"
              value={r}
              defaultChecked={held.has(r)}
              className="h-4 w-4 accent-lode-400"
            />
            {SELF_LABEL[r] ?? ROLE_LABELS[r]}
          </label>
        ))}
      </div>
      {fixed.length > 0 && (
        <p className="text-[12px] leading-relaxed text-ink-500">
          Also on your account:{" "}
          <span className="text-ink-300">
            {fixed.map((r) => ROLE_LABELS[r]).join(", ")}
          </span>
          .{" "}
          {fixed.some(isReservedRole)
            ? "Estate agent and lender are verified by Lode and are not changed here."
            : "Set by Lode and not changed here."}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-8 items-center rounded-md border hairline bg-surface-2 px-3 text-[13px] font-medium text-ink-100 transition-colors hover:bg-surface-3 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {result !== undefined && (
          <span className={`text-xs ${result.ok ? "text-emerald-300" : "text-amber-300"}`}>
            {result.message}
          </span>
        )}
      </div>
    </form>
  );
}

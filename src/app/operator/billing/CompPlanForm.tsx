"use client";

import { useActionState } from "react";
import { Button } from "@/app/components/chrome";
import { compPlanAction, type AdjustmentResult } from "./actions";

/**
 * Comp an account onto a plan — full access, no charge.
 *
 * The reason is required and the result is shown inline. The server writes a
 * granted subscription; entitlements derive from it like any other, so this
 * grants real access rather than setting a flag.
 */
export function CompPlanForm({
  accounts,
  plans,
}: {
  accounts: readonly { id: string; email: string }[];
  plans: readonly { id: string; name: string }[];
}) {
  const [state, submit, pending] = useActionState<AdjustmentResult | undefined, FormData>(
    compPlanAction,
    undefined,
  );

  return (
    <form action={submit} className="mt-6 rounded-2xl border hairline bg-surface-1 px-5 py-4">
      <p className="eyebrow">Comp an account</p>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-300">
        Grant full access to a plan at no charge — for a chosen account, a partner or a test. It is
        a real subscription, recorded against your name, and it can be cancelled like any other.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[12px] text-ink-400">Account</span>
          <select
            name="accountId"
            required
            className="mt-1 w-full rounded-md border hairline bg-surface-2 px-3 py-2 text-[13px] text-ink-100"
          >
            <option value="">Choose…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[12px] text-ink-400">Plan</span>
          <select
            name="planId"
            required
            className="mt-1 w-full rounded-md border hairline bg-surface-2 px-3 py-2 text-[13px] text-ink-100"
          >
            <option value="">Choose…</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3 block">
        <span className="text-[12px] text-ink-400">Reason</span>
        <input
          name="reason"
          required
          minLength={12}
          placeholder="Why this account is being comped"
          className="mt-1 w-full rounded-md border hairline bg-surface-2 px-3 py-2 text-[13px] text-ink-100"
        />
      </label>

      <div className="mt-4 flex items-center gap-3">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Comping…" : "Comp to plan"}
        </Button>
        {state !== undefined && (
          <span className={`text-[12px] ${state.ok ? "text-emerald-300" : "text-red-300"}`}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

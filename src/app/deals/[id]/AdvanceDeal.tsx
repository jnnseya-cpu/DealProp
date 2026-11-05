"use client";

import { useActionState, useState } from "react";
import { transitionDealAction } from "./deal-actions";
import { needsCompletionDate } from "@shared/domain/dealTransition";
import type { DealStatus } from "@shared/domain/types";

const INIT = { ok: false, message: "" };

const LABEL: Record<DealStatus, string> = {
  new: "New",
  qualified: "Qualified",
  "in-market": "In market",
  funded: "Offer accepted (funded)",
  completed: "Completed",
  withdrawn: "Withdrawn",
};

/**
 * Advance a deal through the §10 lifecycle.
 *
 * Only the transitions actually offered from the current status appear, and the
 * completion date is required the moment "Completed" is chosen. The server
 * still decides — this cannot skip a step or complete a deal the evidence does
 * not support (that is `transitionDeal`'s job); the control only keeps the
 * operator from being offered a move that will be refused.
 */
export function AdvanceDeal({
  id,
  current,
  offered,
}: {
  id: string;
  current: DealStatus;
  offered: readonly DealStatus[];
}) {
  const [state, action, pending] = useActionState(transitionDealAction, INIT);
  const [target, setTarget] = useState<DealStatus | "">("");

  if (offered.length === 0) {
    return (
      <p className="text-[13px] text-ink-500">
        This deal is <span className="text-ink-300">{LABEL[current].toLowerCase()}</span> — a terminal status, with no
        further transition.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[13px] text-ink-400">
          Advance to
          <select
            name="target"
            required
            value={target}
            onChange={(e) => setTarget(e.target.value as DealStatus)}
            className="ml-2 h-8 rounded-md border hairline bg-surface-2 px-2 text-sm text-ink-100"
          >
            <option value="">Choose…</option>
            {offered.map((s) => (
              <option key={s} value={s}>
                {LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        {target !== "" && needsCompletionDate(target) && (
          <label className="text-[13px] text-ink-400">
            Completion date
            <input
              type="date"
              name="completedAt"
              required
              className="ml-2 h-8 rounded-md border hairline bg-surface-2 px-2 text-sm text-ink-100"
            />
          </label>
        )}
        <button
          type="submit"
          disabled={pending || target === ""}
          className="inline-flex h-8 items-center rounded-md border hairline bg-surface-2 px-3 text-[13px] text-ink-100 transition-colors hover:border-ink-600 hover:bg-surface-3 disabled:opacity-60"
        >
          {pending ? "Recording…" : "Record transition"}
        </button>
      </div>
      {state.message !== "" && (
        <p className={`text-[12px] ${state.ok ? "text-emerald-300" : "text-amber-300"}`}>{state.message}</p>
      )}
    </form>
  );
}

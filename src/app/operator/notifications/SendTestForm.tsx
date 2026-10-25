"use client";

import { useActionState } from "react";
import { Button } from "@/app/components/chrome";
import { sendTestNotification, type TestResult } from "./actions";

export function SendTestForm({
  events,
}: {
  events: readonly { key: string; title: string }[];
}) {
  const [state, submit, pending] = useActionState<TestResult | undefined, FormData>(
    sendTestNotification,
    undefined,
  );

  return (
    <form action={submit} className="flex flex-wrap items-center gap-3">
      <select
        name="eventKey"
        required
        aria-label="Event to fire"
        className="rounded-md border hairline bg-surface-2 px-3 py-2 text-[13px] text-ink-100"
      >
        {events.map((e) => (
          <option key={e.key} value={e.key}>
            {e.title} — {e.key}
          </option>
        ))}
      </select>
      <Button type="submit" variant="primary" size="sm" disabled={pending}>
        {pending ? "Firing…" : "Send test to me"}
      </Button>
      {state !== undefined && (
        <span className={`text-[12px] ${state.ok ? "text-emerald-300" : "text-red-300"}`}>
          {state.message}
        </span>
      )}
    </form>
  );
}

import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader, Badge } from "@/app/components/chrome";
import { requirePermission } from "@/app/operator/guard";
import { listOperatorTasks } from "@backend/store/repository";
import { isOpen, type OperatorTask, type OperatorTaskType } from "@shared/domain/operatorTask";
import { resolveTaskAction } from "@/app/operator/tasks/actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Worklist — Lode" };

/**
 * The operator worklist (§9/A03).
 *
 * Follow-ups a person owns — a recipient replied, a conversation needs a human.
 * An inbound event that stops the machine lands here rather than in a stamped
 * field nobody reads. Resolving one is a named person taking it off the queue,
 * recorded on the audit trail. A read-and-resolve surface; tasks are opened by
 * the events themselves, never here.
 */

const TYPE_LABEL: Record<OperatorTaskType, string> = {
  "outreach-reply": "Outreach reply",
  "intake-review": "Intake review",
  general: "General",
};

function Row({ task }: { task: OperatorTask }) {
  return (
    <li className="flex flex-col gap-1.5 px-5 py-3.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Badge tone={isOpen(task) ? "warn" : "good"}>{isOpen(task) ? "Open" : "Resolved"}</Badge>
          <span className="text-sm text-ink-200">{TYPE_LABEL[task.type]}</span>
        </div>
        <span className="text-xs text-ink-600 tabular-nums">{task.createdAt.replace("T", " ").slice(0, 16)}</span>
      </div>
      <p className="text-sm text-ink-400">{task.reason}</p>
      <p className="font-mono text-[11px] text-ink-600">
        {task.subjectType} · {task.subjectId.slice(0, 8)}
      </p>
      {isOpen(task) ? (
        <form action={resolveTaskAction} className="mt-1 flex items-center gap-2">
          <input type="hidden" name="id" value={task.id} />
          <input
            type="text"
            name="note"
            required
            maxLength={2000}
            placeholder="How it was handled"
            className="h-7 min-w-0 flex-1 rounded-md border hairline bg-surface-2 px-2 text-xs text-ink-100 placeholder:text-ink-600"
          />
          <button
            type="submit"
            className="h-7 shrink-0 rounded-md border hairline bg-surface-2 px-2.5 text-xs text-ink-200 transition-colors hover:border-ink-600 hover:bg-surface-3"
          >
            Resolve
          </button>
        </form>
      ) : (
        <p className="text-[11px] text-emerald-300/80">
          ✓ {task.resolvedByName ?? "resolved"}
          {task.resolutionNote !== undefined && task.resolutionNote !== "" ? ` — ${task.resolutionNote}` : ""}
        </p>
      )}
    </li>
  );
}

export default async function TasksPage() {
  await requirePermission("view-audit-log", "/operator/tasks");
  const all = await listOperatorTasks();
  // Open first (the live queue), then recently resolved for context.
  const open = all.filter(isOpen);
  const resolved = all.filter((t) => !isOpen(t)).slice(0, 25);

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader trailing={<OperatorNav current="/operator/tasks" />} />

      <div className="mx-auto max-w-4xl px-6 py-10">
        <span className="eyebrow">Worklist</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {open.length === 0 ? "Nothing waiting" : `${open.length} to follow up`}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          Follow-ups a person owns — a recipient replied, the automated sends stopped. An inbound
          event lands here rather than in a field nobody reads. Resolving one is recorded against
          your account.
        </p>

        {all.length === 0 ? (
          <p className="mt-10 rounded-2xl border hairline bg-surface-1 px-5 py-6 text-sm text-ink-400">
            No tasks. A reply to outreach opens one here.
          </p>
        ) : (
          <>
            <ul className="mt-8 divide-y divide-ink-800/60 overflow-hidden rounded-2xl border hairline bg-surface-1">
              {open.map((t) => (
                <Row key={t.id} task={t} />
              ))}
              {open.length === 0 && <li className="px-5 py-6 text-sm text-ink-500">Nothing open.</li>}
            </ul>
            {resolved.length > 0 && (
              <>
                <h2 className="eyebrow mt-10">Recently resolved</h2>
                <ul className="mt-3 divide-y divide-ink-800/60 overflow-hidden rounded-2xl border hairline bg-surface-1">
                  {resolved.map((t) => (
                    <Row key={t.id} task={t} />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

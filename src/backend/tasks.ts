import { randomUUID } from "node:crypto";
import { getOperatorTask, listOperatorTasks, saveOperatorTask } from "@backend/store/repository";
import { audit } from "@backend/audit";
import {
  dedupeKeyFor,
  openTask,
  resolveTask,
  type OperatorTask,
  type OperatorTaskType,
} from "@shared/domain/operatorTask";

/**
 * The operator worklist service (§9/A03).
 *
 * `raiseTask` is idempotent on the subject-and-type key: an event that fires
 * more than once — a recipient replying twice — creates one open task, not a
 * pile. `resolveOperatorTask` is a named person taking it off the queue, on the
 * append-only audit trail.
 */

export interface RaiseTaskInput {
  readonly type: OperatorTaskType;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly reason: string;
}

/**
 * Open a task unless one of the same subject and type is already open. Returns
 * the open task (existing or new); never a second open duplicate.
 */
export async function raiseTask(input: RaiseTaskInput, now: Date = new Date()): Promise<OperatorTask> {
  const key = dedupeKeyFor(input.subjectType, input.subjectId, input.type);
  const existingOpen = (await listOperatorTasks()).find((t) => t.status === "open" && t.dedupeKey === key);
  if (existingOpen !== undefined) return existingOpen;

  const task = openTask({
    id: randomUUID(),
    type: input.type,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    reason: input.reason,
    createdAt: now.toISOString(),
  });
  return saveOperatorTask(task);
}

export interface ResolveResult {
  readonly ok: boolean;
  readonly message: string;
}

export interface TaskActor {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

/** A named person resolves an open task, recording why. */
export async function resolveOperatorTask(
  id: string,
  note: string,
  actor: TaskActor,
  now: Date = new Date(),
): Promise<ResolveResult> {
  const trimmed = note.trim();
  if (trimmed === "") return { ok: false, message: "Say how it was resolved." };
  const task = await getOperatorTask(id);
  if (task === undefined) return { ok: false, message: "No such task." };
  if (task.status !== "open") return { ok: false, message: "That task is already resolved." };

  await saveOperatorTask(
    resolveTask(task, { by: actor.id, byName: actor.name, note: trimmed, at: now.toISOString() }),
  );
  await audit("operator-task-resolved", {
    account: { id: actor.id, email: actor.email },
    subject: task.subjectId,
    detail: `${actor.name} resolved ${task.type} task ${id.slice(0, 8)} — ${trimmed}`,
  });
  return { ok: true, message: `Resolved against ${actor.name}.` };
}

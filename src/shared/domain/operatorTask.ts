/**
 * The operator worklist (spec §9 / A03, §20.11 "pending task age").
 *
 * A task is a thing a named person needs to pick up: a recipient replied to
 * outreach, an agent run is waiting, a check could not be run. It exists so an
 * inbound event that stops the machine — a reply pauses the automated sends —
 * does not then vanish into a stamped field nobody looks at; it lands on a
 * queue a person works down.
 *
 * Deliberately NOT an automated marketing nurture sequence. Decision #10 and §9
 * are explicit: sellers are never auto-enrolled, and a service reply must not
 * silently enrol anybody into marketing. So this is the operator-facing half of
 * §9 — the follow-up task — not a scheduler that writes to people, which would
 * be a control with no lawful population to run on.
 *
 * Pure and framework-free: the record and the two state changes (open, resolve).
 * The store persists it and the producers create it; a person resolves it.
 */

export type OperatorTaskType =
  /** A recipient replied to an outreach message — the sends stop; a person follows up. */
  | "outreach-reply"
  /** A seller-intake conversation needs a person (held by the gate). */
  | "intake-review"
  /** Anything else a producer needs a person to see. */
  | "general";

export type OperatorTaskStatus = "open" | "resolved";

export interface OperatorTask {
  readonly id: string;
  readonly type: OperatorTaskType;
  /** What the task is about, e.g. "deal", "outreach-message", "intake-conversation". */
  readonly subjectType: string;
  readonly subjectId: string;
  /** One line, in the operator's words. No personal data — reference the subject by id. */
  readonly reason: string;
  readonly createdAt: string;
  readonly status: OperatorTaskStatus;
  /**
   * Identity for de-duplication: one open task per subject and type. A second
   * reply from the same recipient does not spawn a second task while the first
   * is still open (spec §19.6 task uniqueness).
   */
  readonly dedupeKey: string;
  readonly resolvedBy?: string;
  readonly resolvedByName?: string;
  readonly resolvedAt?: string;
  readonly resolutionNote?: string;
}

export interface OperatorTaskSeed {
  readonly id: string;
  readonly type: OperatorTaskType;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly reason: string;
  readonly createdAt: string;
}

export function dedupeKeyFor(subjectType: string, subjectId: string, type: OperatorTaskType): string {
  return `${subjectType}:${subjectId}:${type}`;
}

export function openTask(seed: OperatorTaskSeed): OperatorTask {
  return {
    id: seed.id,
    type: seed.type,
    subjectType: seed.subjectType,
    subjectId: seed.subjectId,
    reason: seed.reason,
    createdAt: seed.createdAt,
    status: "open",
    dedupeKey: dedupeKeyFor(seed.subjectType, seed.subjectId, seed.type),
  };
}

export function isOpen(task: OperatorTask): boolean {
  return task.status === "open";
}

export interface TaskResolution {
  readonly by: string;
  readonly byName: string;
  readonly note: string;
  readonly at: string;
}

/**
 * Resolve an open task. Only an open task can be resolved, and only once — a
 * second resolution would overwrite who actually dealt with it, so the first
 * stands.
 */
export function resolveTask(task: OperatorTask, resolution: TaskResolution): OperatorTask {
  if (task.status !== "open") return task;
  return {
    ...task,
    status: "resolved",
    resolvedBy: resolution.by,
    resolvedByName: resolution.byName,
    resolvedAt: resolution.at,
    resolutionNote: resolution.note,
  };
}

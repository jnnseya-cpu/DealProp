import { describe, expect, it } from "vitest";
import { dedupeKeyFor, isOpen, openTask, resolveTask, type OperatorTask } from "@shared/domain/operatorTask";

const seed = {
  id: "task-1",
  type: "outreach-reply" as const,
  subjectType: "outreach-message",
  subjectId: "msg-1",
  reason: "A recipient replied.",
  createdAt: "2026-06-15T12:00:00.000Z",
};

describe("the operator task", () => {
  it("opens with a dedupe key of subject and type", () => {
    const task = openTask(seed);
    expect(isOpen(task)).toBe(true);
    expect(task.dedupeKey).toBe(dedupeKeyFor("outreach-message", "msg-1", "outreach-reply"));
    expect(task.resolvedAt).toBeUndefined();
  });

  it("resolves an open task with who and why", () => {
    const task = resolveTask(openTask(seed), { by: "acc-1", byName: "Jo", note: "Called back.", at: "2026-06-15T13:00:00.000Z" });
    expect(task.status).toBe("resolved");
    expect(task.resolvedByName).toBe("Jo");
    expect(task.resolutionNote).toBe("Called back.");
    expect(isOpen(task)).toBe(false);
  });

  it("keeps the first resolution rather than letting a second overwrite it", () => {
    const first: OperatorTask = resolveTask(openTask(seed), { by: "acc-1", byName: "Jo", note: "first", at: "2026-06-15T13:00:00.000Z" });
    const second = resolveTask(first, { by: "acc-2", byName: "Sam", note: "second", at: "2026-06-15T14:00:00.000Z" });
    expect(second).toBe(first);
    expect(second.resolvedByName).toBe("Jo");
  });
});

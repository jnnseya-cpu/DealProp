import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The operator worklist service (§9/A03): a repeated event opens one task, not
 * a pile, and a named person resolves it onto the audit trail.
 */

const SCRATCH = mkdtempSync(path.join(tmpdir(), "lode-tasks-"));
process.env.LODE_DATA_FILE = path.join(SCRATCH, "lode.json");
delete process.env.DATABASE_URL;

const { raiseTask, resolveOperatorTask } = await import("@backend/tasks");
const { listOperatorTasks, listAudit } = await import("@backend/store/repository");

afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));
beforeEach(() => rmSync(process.env.LODE_DATA_FILE ?? "", { force: true }));

const jo = { id: "acc-1", email: "jo@example.com", name: "Jo Bloggs" };
const reply = { type: "outreach-reply" as const, subjectType: "outreach-message", subjectId: "msg-1", reason: "A recipient replied." };

describe("raising a task", () => {
  it("opens one task per subject and type, not a pile", async () => {
    await raiseTask(reply);
    await raiseTask(reply);
    const open = (await listOperatorTasks()).filter((t) => t.status === "open");
    expect(open).toHaveLength(1);
  });

  it("opens separate tasks for separate subjects", async () => {
    await raiseTask(reply);
    await raiseTask({ ...reply, subjectId: "msg-2" });
    expect((await listOperatorTasks()).filter((t) => t.status === "open")).toHaveLength(2);
  });
});

describe("resolving a task", () => {
  it("records a named resolution and audits it, then refuses a second", async () => {
    const task = await raiseTask(reply);

    expect((await resolveOperatorTask(task.id, "", jo)).ok).toBe(false); // needs a note
    const ok = await resolveOperatorTask(task.id, "Called back, booked a valuation.", jo);
    expect(ok.ok).toBe(true);

    const resolved = (await listOperatorTasks()).find((t) => t.id === task.id);
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.resolvedByName).toBe("Jo Bloggs");

    const audit = await listAudit({ subject: "msg-1" });
    expect(audit.some((e) => e.action === "operator-task-resolved")).toBe(true);

    expect((await resolveOperatorTask(task.id, "again", jo)).ok).toBe(false);
  });

  it("after a task is resolved, the same event opens a fresh one", async () => {
    const first = await raiseTask(reply);
    await resolveOperatorTask(first.id, "done", jo);
    const second = await raiseTask(reply);
    expect(second.id).not.toBe(first.id);
    expect((await listOperatorTasks()).filter((t) => t.status === "open")).toHaveLength(1);
  });
});

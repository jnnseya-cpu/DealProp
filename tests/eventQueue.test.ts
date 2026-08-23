import { describe, expect, it } from "vitest";
import { createEventQueue } from "@shared/eventQueue";

/**
 * The bug this module exists for: events fired while a page mounts were sent
 * straight at vendor globals that did not exist yet, and vanished. `page_view`
 * hid it, because its effect re-runs once consent resolves.
 */

describe("holding events until the senders exist", () => {
  it("holds an event fired before any sender is ready", () => {
    const queue = createEventQueue(2);
    let sent = 0;

    queue.deliver(() => {
      sent += 1;
    });

    expect(sent).toBe(0);
    expect(queue.waiting()).toBe(1);
  });

  it("keeps holding until every configured sender has reported", () => {
    // Google ready and Meta not is exactly the state that would send half the
    // events and drop the rest.
    const queue = createEventQueue(2);
    let sent = 0;
    queue.deliver(() => {
      sent += 1;
    });

    queue.senderReady();
    expect(sent).toBe(0);

    queue.senderReady();
    expect(sent).toBe(1);
    expect(queue.waiting()).toBe(0);
  });

  it("sends immediately once ready, without queueing", () => {
    const queue = createEventQueue(1);
    queue.senderReady();

    let sent = 0;
    queue.deliver(() => {
      sent += 1;
    });

    expect(sent).toBe(1);
    expect(queue.waiting()).toBe(0);
  });

  it("preserves order", () => {
    const queue = createEventQueue(1);
    const order: string[] = [];
    queue.deliver(() => order.push("view"));
    queue.deliver(() => order.push("page"));
    queue.senderReady();

    expect(order).toEqual(["view", "page"]);
  });

  it("does not replay a drained event when another sender reports late", () => {
    const queue = createEventQueue(1);
    let sent = 0;
    queue.deliver(() => {
      sent += 1;
    });

    queue.senderReady();
    queue.senderReady();

    expect(sent).toBe(1);
  });

  it("sends without waiting when nothing is configured", () => {
    // No pixel IDs set. The caller's own no-op checks still apply; this must
    // not silently swallow the call into a queue nothing will ever drain.
    const queue = createEventQueue(0);
    let sent = 0;
    queue.deliver(() => {
      sent += 1;
    });

    expect(sent).toBe(1);
  });

  it("drops the overflow rather than growing without bound", () => {
    // A sender that never arrives — blocked domain, offline tab — means nothing
    // ever drains this. Each held event is a closure holding what it captured.
    const queue = createEventQueue(1, 3);
    for (let i = 0; i < 10; i += 1) {
      queue.deliver(() => undefined);
    }

    expect(queue.waiting()).toBe(3);
  });

  it("delivers an event queued by an event being drained", () => {
    const queue = createEventQueue(1);
    const order: string[] = [];

    queue.deliver(() => {
      order.push("first");
      queue.deliver(() => order.push("second"));
    });
    queue.senderReady();

    expect(order).toEqual(["first", "second"]);
  });
});

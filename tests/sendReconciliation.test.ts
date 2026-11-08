import { describe, expect, it } from "vitest";
import { reconcileSend } from "@shared/domain/sendReconciliation";

/**
 * A13 / §13 — a timed-out send is never blindly resent. The decision is driven
 * only by what a provider lookup found, and fails closed to escalation.
 */

describe("reconcileSend", () => {
  it("does not resend when the provider confirms the message exists", () => {
    expect(reconcileSend("accepted").decision).toBe("already-sent");
  });

  it("allows a retry only when the provider has no record of it", () => {
    expect(reconcileSend("not-found").decision).toBe("safe-to-retry");
  });

  it("escalates an ambiguous lookup rather than guessing", () => {
    expect(reconcileSend("unknown").decision).toBe("escalate");
  });

  it("escalates when no lookup-capable provider is configured (fails closed)", () => {
    expect(reconcileSend(undefined).decision).toBe("escalate");
  });
});

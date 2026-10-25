"use server";

import { requirePermission } from "@/app/operator/guard";
import { emit } from "@backend/notifications/engine";
import { notificationEvent } from "@shared/domain/notifications";

export interface TestResult {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * Fire any catalogue event to the signed-in operator, across its lawful
 * channels. Email is sandboxed unless a provider key is set, so the flow is
 * always testable. It needs a named account — the shared password has no inbox
 * or address to receive the test.
 */
export async function sendTestNotification(
  _previous: TestResult | undefined,
  formData: FormData,
): Promise<TestResult> {
  const viewer = await requirePermission("view-audit-log", "/operator/notifications");
  if (viewer.kind !== "account") {
    return {
      ok: false,
      message:
        "Sign in with your own account rather than the shared password — a test needs an inbox and an address to go to.",
    };
  }

  const key = String(formData.get("eventKey") ?? "");
  if (notificationEvent(key) === undefined) return { ok: false, message: "Unknown event." };

  const result = await emit(key, { account: viewer.account, dedupe: `test:${Date.now()}` });
  if (result.delivered.length === 0) {
    return {
      ok: true,
      message: "Fired, but no channel was permitted for your account — check reachability and consent.",
    };
  }
  return {
    ok: true,
    message: `Fired on: ${result.delivered.join(", ")}. Check your inbox at /account/inbox; email is sandboxed unless a provider key is set.`,
  };
}

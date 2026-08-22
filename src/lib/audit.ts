import { randomUUID } from "node:crypto";
import { appendAudit, type AuditAction, type AuditEvent } from "@/store/repository";
import type { Account } from "@/domain/accounts";

/**
 * Writing to the audit trail.
 *
 * One helper so every call site records the same shape, and so the id and
 * timestamp are never supplied by a caller who might reuse them.
 *
 * Failures are swallowed deliberately. An audit write that throws would take
 * down the page it was recording, which turns a logging outage into an outage;
 * and a viewer denied access because the log was full is a denial of service
 * dressed as a security control. The write is best-effort and the failure is
 * reported to the server console, where it is somebody's problem to fix.
 */
export async function audit(
  action: AuditAction,
  {
    account,
    email,
    subject,
    detail,
  }: {
    account?: Pick<Account, "id" | "email">;
    email?: string;
    subject?: string;
    detail?: string;
  } = {},
): Promise<void> {
  const event: AuditEvent = {
    id: randomUUID(),
    at: new Date().toISOString(),
    action,
    ...(account !== undefined ? { accountId: account.id, email: account.email } : {}),
    ...(account === undefined && email !== undefined ? { email } : {}),
    ...(subject !== undefined ? { subject } : {}),
    ...(detail !== undefined ? { detail } : {}),
  };

  try {
    await appendAudit(event);
  } catch (error) {
    process.stderr.write(`audit write failed for ${action}: ${String(error)}\n`);
  }
}

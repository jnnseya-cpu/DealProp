import type { OperatorPermissions } from "@shared/domain/regulatoryRoute";
import {
  heldKeys,
  holds,
  readPermissions,
  type PermissionKey,
  type PermissionSet,
} from "@shared/domain/permissions";

/**
 * What this operator is actually permitted to do, as recorded.
 *
 * Read from configuration rather than from code, and absent by default. The
 * same rule the revenue engine follows: a permission that has not been recorded
 * as held is not held, and the platform behaves accordingly rather than
 * assuming the paperwork exists somewhere.
 *
 * `HELD_PERMISSIONS` is the single source, shared by the regulatory router, the
 * revenue model, the charge gate and the fee engine, so a permission is
 * declared once. Nothing here grants anything — it reports what somebody has
 * recorded, and recording it wrongly is a decision with consequences this file
 * cannot prevent.
 */

/**
 * Everything recorded, once, for every engine that asks.
 *
 * `HELD_PERMISSIONS` is `key:evidence` pairs — a bare key grants nothing, and
 * `readPermissions` reports it as unevidenced so the preflight can say so
 * rather than the platform quietly behaving as though the permission is absent.
 */
export function permissionSet(
  raw: string | undefined = process.env.HELD_PERMISSIONS,
): PermissionSet {
  return readPermissions(raw);
}

/** The keys, for the engines that only need the answer. */
export function permissionsHeld(
  raw: string | undefined = process.env.HELD_PERMISSIONS,
): readonly PermissionKey[] {
  return heldKeys(readPermissions(raw));
}

/** The three the regulatory router asks about, in the shape it expects. */
export function operatorPermissions(
  raw: string | undefined = process.env.HELD_PERMISSIONS,
): OperatorPermissions {
  const set = readPermissions(raw);
  return {
    regulatedMortgageIntroductions: holds(set, "regulated-mortgage-introductions"),
    creditBroking: holds(set, "credit-broking"),
    promotionApprover: holds(set, "financial-promotion-approver"),
  };
}

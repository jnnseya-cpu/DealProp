import type { OperatorPermissions } from "@shared/domain/regulatoryRoute";

/**
 * What this operator is actually permitted to do, as recorded.
 *
 * Read from configuration rather than from code, and absent by default. The
 * same rule the revenue engine follows: a permission that has not been recorded
 * as held is not held, and the platform behaves accordingly rather than
 * assuming the paperwork exists somewhere.
 *
 * `HELD_PERMISSIONS` is a comma-separated list, shared with `revenue.ts` so
 * there is one place a permission is declared. Nothing here grants anything —
 * it reports what somebody has stated, and stating it wrongly is a decision
 * with consequences that this file cannot prevent.
 */

export const PERMISSION_KEYS = {
  regulatedMortgageIntroductions: "regulated-mortgage-introductions",
  creditBroking: "credit-broking",
  promotionApprover: "financial-promotion-approver",
} as const;

export function operatorPermissions(
  raw: string | undefined = process.env.HELD_PERMISSIONS,
): OperatorPermissions {
  const held = new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  return {
    regulatedMortgageIntroductions: held.has(PERMISSION_KEYS.regulatedMortgageIntroductions),
    creditBroking: held.has(PERMISSION_KEYS.creditBroking),
    promotionApprover: held.has(PERMISSION_KEYS.promotionApprover),
  };
}

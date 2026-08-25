import type { Account } from "@shared/domain/accounts";
import { entitlementsFor, type Entitlements } from "@shared/domain/entitlements";
import { PLANS } from "@shared/domain/pricing";
import { getSubscription } from "@backend/store/repository";

/**
 * What the person behind this request is entitled to.
 *
 * Two populations, and conflating them is how a platform ends up either
 * charging its own staff or handing customers a staff account.
 *
 * **Staff** — the shared operator password, and accounts holding an internal
 * role — are not customers and hold no subscription. They get the widest limits
 * in the catalogue, because a limit on the people running the platform protects
 * nobody and would stop the pipeline working.
 *
 * **Customers** — investors and funders — get exactly what their subscription
 * says, computed fresh from the record on every request. There is no cached
 * flag, so there is nothing an ended subscription can leave switched on.
 *
 * Takes the account rather than the request's viewer, because `src/backend` may
 * not import from `src/app`. `undefined` means an authenticated caller with no
 * named account, which is the shared operator password and therefore staff —
 * this is only ever called after a permission check has already passed.
 */

function staffEntitlements(): Entitlements {
  const widest = PLANS.reduce((best, candidate) =>
    candidate.limits.memorandaPerPeriod > best.limits.memorandaPerPeriod ? candidate : best,
  );
  return {
    ...widest.limits,
    maxBuyBoxes: "unlimited",
    maxFundingBoxes: "unlimited",
    planId: widest.id,
    billedPlanId: widest.id,
    status: "active",
    mayExtractValue: true,
    reason: "Staff access. Plan limits apply to customers, not to the people running the platform.",
  };
}

export async function entitlementsForAccount(
  account: Pick<Account, "id" | "role"> | undefined,
): Promise<Entitlements> {
  if (account === undefined) return staffEntitlements();
  if (account.role === "admin" || account.role === "operator") return staffEntitlements();

  return entitlementsFor(await getSubscription(account.id));
}

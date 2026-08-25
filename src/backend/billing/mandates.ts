import type { BuyBox, FundingBox } from "@shared/domain/matching";
import { withinPlan } from "@shared/domain/entitlements";
import { listBuyBoxes, listFundingBoxes } from "@backend/store/repository";
import { entitlementsForAccount } from "@backend/billing/entitlement";
import { getAccount } from "@backend/store/repository";

/**
 * Mandates a plan still covers.
 *
 * The quiet leak this closes: somebody creates ten Buy Boxes on the plan that
 * allows unlimited, drops to the plan that includes three, and keeps all ten —
 * because a limit checked only at creation is a limit that a downgrade walks
 * straight through.
 *
 * Nothing is deleted. Destroying a customer's work over a billing change is
 * both wrong and irreversible, and they may upgrade again tomorrow. What
 * happens instead is that everything past the limit stops counting: it is not
 * matched, and it does not appear in the number of interested buyers shown to a
 * seller.
 *
 * That second consequence is the one that matters most. A mandate is a
 * statement of real demand made to a member of the public who is deciding
 * whether to sell their home. Counting mandates nobody is currently paying to
 * hold would overstate that demand, which is a worse problem than the lost
 * subscription revenue.
 *
 * Mandates with no owner are always covered. Those are the ones an operator
 * created on somebody's behalf, and staff are not on a plan.
 */

async function coverageFor<T extends { readonly id: string; readonly ownerAccountId?: string }>(
  items: readonly T[],
  limitOf: (entitlements: Awaited<ReturnType<typeof entitlementsForAccount>>) => number | "unlimited",
): Promise<readonly T[]> {
  const owned = new Map<string, T[]>();
  const unowned: T[] = [];

  for (const item of items) {
    if (item.ownerAccountId === undefined) {
      unowned.push(item);
      continue;
    }
    const list = owned.get(item.ownerAccountId) ?? [];
    list.push(item);
    owned.set(item.ownerAccountId, list);
  }

  const covered: T[] = [...unowned];

  for (const [accountId, list] of owned) {
    const account = await getAccount(accountId);
    // An owner whose account has gone is not a paying owner. Their mandates
    // stop counting rather than counting forever.
    if (account === undefined || account.disabledAt !== undefined) continue;

    const entitlements = await entitlementsForAccount(account);
    covered.push(...withinPlan(list, limitOf(entitlements)).covered);
  }

  return covered;
}

export async function coveredBuyBoxes(): Promise<readonly BuyBox[]> {
  return coverageFor(await listBuyBoxes(), (e) => e.maxBuyBoxes);
}

export async function coveredFundingBoxes(): Promise<readonly FundingBox[]> {
  return coverageFor(await listFundingBoxes(), (e) => e.maxFundingBoxes);
}

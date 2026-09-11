import { decrypt, encrypt, isEncrypted, readKey } from "@backend/crypto/fieldCipher";
import type { DealRecord, Store } from "@backend/store/schema";

/**
 * Encryption applied to the store, rather than to each engine.
 *
 * `repository.ts` picks one of two engines and both serialise a `DealRecord`.
 * Putting the encryption in each would be the same code twice with one chance
 * to forget, so it goes here and wraps whichever engine was chosen. The
 * contract suite runs against both, so a miss in either fails.
 *
 * Only two fields are covered, and the narrowness is the point rather than an
 * omission. Encrypting a column you filter on makes it unfilterable, and
 * encrypting everything means decrypting everything on every page load for no
 * benefit. What is here is what would be worst to lose:
 *
 *   `seller.narrative`   free text somebody typed about a bereavement, an
 *                        illness or a repossession, in their own words.
 *   `seller.screening`   the structured answers behind it, including health
 *                        and capacity concerns and reported financial
 *                        distress. Special-category data under Article 9, and
 *                        the reason this platform has an ICO registration
 *                        blocker in its preflight at all.
 *
 * The seller due diligence record is covered too, for the same reason and by
 * the same test: `authorityEvidence` is a sentence describing a grant of
 * probate or a power of attorney, `enhancedMeasures` describes what was done
 * about a risk somebody was flagged for, and the beneficial owners are named
 * individuals. The dates are left alone — they are used to decide whether a
 * check has lapsed, they identify nobody on their own, and encrypting a
 * timestamp to protect a name is the sort of thing that reads as thorough and
 * is not.
 *
 * The property, the price and the appraisal are not encrypted. They are
 * commercial facts, they are what the engine filters and sorts on, and a
 * postcode area is not a person.
 */

/** The screening answers, stored as one encrypted JSON blob. */
const SCREENING = "screening" as const;

/**
 * The seller appears twice in a `DealRecord` and both copies are real.
 *
 * `record.seller` is the profile. `record.inputs.seller` is the same person as
 * the engine received them, kept because an appraisal has to be reproducible
 * from its own inputs. Sealing one and not the other is worse than sealing
 * neither: it looks encrypted, it reports as encrypted, and the plaintext is
 * four lines further down the same JSON document. Caught by reading the file
 * rather than the round-trip test, which passed perfectly.
 */
type SellerLike = {
  situation?: unknown;
  narrative?: string;
  screening?: unknown;
};

function sealSeller<T extends SellerLike>(seller: T, key: Buffer): T {
  const narrative = seller.narrative;
  const screening = seller[SCREENING];
  const situation = seller.situation;

  return {
    ...seller,
    // "repossession-threat", "divorce", "probate", "bereavement". Neither
    // engine filters on it in SQL — checked, not assumed — so encrypting it
    // costs nothing, and of the three fields it is the one that most plainly
    // describes a person's circumstances in a single word.
    ...(typeof situation === "string" ? { situation: encrypt(situation, key) } : {}),
    ...(narrative !== undefined && narrative !== ""
      ? { narrative: encrypt(narrative, key) }
      : {}),
    // The whole object as one value. Field by field would leak the shape —
    // whether a capacity concern was answered at all is itself informative.
    ...(screening !== undefined
      ? { [SCREENING]: { sealed: encrypt(JSON.stringify(screening), key) } }
      : {}),
  };
}

function openSeller<T extends SellerLike>(seller: T, key: Buffer | undefined): T {
  const narrative = seller.narrative;
  const screening: unknown = seller[SCREENING];
  const situation = seller.situation;

  const opened =
    narrative !== undefined && isEncrypted(narrative) ? decrypt(narrative, key) : narrative;

  const unsealed =
    screening !== null &&
    typeof screening === "object" &&
    "sealed" in screening &&
    typeof (screening as { sealed: unknown }).sealed === "string"
      ? (JSON.parse(decrypt((screening as { sealed: string }).sealed, key)) as unknown)
      : screening;

  return {
    ...seller,
    ...(typeof situation === "string" && isEncrypted(situation)
      ? { situation: decrypt(situation, key) }
      : {}),
    ...(opened !== undefined ? { narrative: opened } : {}),
    ...(unsealed !== undefined ? { [SCREENING]: unsealed } : {}),
  };
}

/**
 * A deal on its way into the store.
 *
 * Structurally identical to a `DealRecord` — the encrypted fields are still
 * strings — so nothing downstream needs a second type. That is what makes this
 * safe to wrap around an engine that knows nothing about it.
 */
type ChecksLike = {
  authorityEvidence?: string;
  enhancedMeasures?: string;
  beneficialOwners?: readonly { name: string }[];
};

function mapChecks<T extends ChecksLike>(
  checks: T | undefined,
  transform: (value: string) => string,
): T | undefined {
  if (checks === undefined) return undefined;
  return {
    ...checks,
    ...(checks.authorityEvidence !== undefined
      ? { authorityEvidence: transform(checks.authorityEvidence) }
      : {}),
    ...(checks.enhancedMeasures !== undefined
      ? { enhancedMeasures: transform(checks.enhancedMeasures) }
      : {}),
    ...(checks.beneficialOwners !== undefined
      ? {
          beneficialOwners: checks.beneficialOwners.map((owner) => ({
            ...owner,
            name: transform(owner.name),
          })),
        }
      : {}),
  };
}

export function sealDeal(deal: DealRecord): DealRecord {
  const key = readKey();
  if (key === undefined) return deal;

  const checks = mapChecks(deal.sellerChecks, (value) => encrypt(value, key));

  return {
    ...deal,
    seller: sealSeller(deal.seller, key),
    inputs: { ...deal.inputs, seller: sealSeller(deal.inputs.seller, key) },
    ...(checks !== undefined ? { sellerChecks: checks } : {}),
  } as DealRecord;
}

/** The same record on the way out. */
export function openDeal(deal: DealRecord): DealRecord {
  const key = readKey();
  const checks = mapChecks(deal.sellerChecks, (value) =>
    isEncrypted(value) ? decrypt(value, key) : value,
  );

  return {
    ...deal,
    seller: openSeller(deal.seller, key),
    inputs: { ...deal.inputs, seller: openSeller(deal.inputs.seller, key) },
    ...(checks !== undefined ? { sellerChecks: checks } : {}),
  } as DealRecord;
}

/**
 * The engine, with the two deal fields sealed on the way in and opened on the
 * way out.
 *
 * Every deal entry point is covered — there are four, and a fifth added to the
 * `Store` contract without being wrapped here would store plaintext silently.
 * A test walks the contract for methods whose name mentions a deal and fails
 * on one this does not know about, because "I remembered" is not a control.
 */
export function sealed(store: Store): Store {
  return {
    ...store,
    listDeals: async () => (await store.listDeals()).map(openDeal),
    pageDeals: async (limit, offset) => {
      const page = await store.pageDeals(limit, offset);
      return { ...page, rows: page.rows.map(openDeal) };
    },
    getDeal: async (id) => {
      const deal = await store.getDeal(id);
      return deal === undefined ? undefined : openDeal(deal);
    },
    saveDeal: async (deal) => openDeal(await store.saveDeal(sealDeal(deal))),
    replaceAll: async (db) => store.replaceAll({ ...db, deals: db.deals.map(sealDeal) }),
  };
}

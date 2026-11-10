import { buildPlatformCandidates, type PlatformDemandInput } from "@shared/domain/trend/platformDemand";
import type { TrendObservationSource } from "@shared/domain/trend/candidate";
import { listBlogViews, listBuyBoxes, listDeals, listIntakeConversations } from "@backend/store/repository";
import { fixturesEnabled, trendObservationSource as fixtureObservationSource } from "@backend/trend/fixtureSource";

/**
 * Trend Intelligence — the live observation source, reading LODE's OWN data.
 *
 * This is the embedding: the engine does not run on a synthetic installation, it
 * runs on the platform's real first-party demand. Deals and seller enquiries are
 * the demand series, blog opens are the owned-page attention family, and the
 * active Buy Box count is the readiness signal — exactly the same stores every
 * other surface reads. With no real demand on record the source is empty (the
 * honest coverage boundary, never zero-interest).
 *
 * `TREND_FIXTURES=1` substitutes the dev-only synthetic set, for exercising the
 * engine against known data; it is never production.
 */
export async function platformObservationSource(now: Date = new Date()): Promise<TrendObservationSource> {
  if (fixturesEnabled()) return fixtureObservationSource("lode");

  const [deals, intake, blogViews, buyBoxes] = await Promise.all([
    listDeals(),
    listIntakeConversations(),
    listBlogViews(),
    listBuyBoxes(),
  ]);

  const pageAttention = blogViews.reduce((sum, v) => sum + v.views, 0);
  const pageAttentionLatest = blogViews
    .map((v) => v.lastViewedAt)
    .sort()
    .at(-1);

  const input: PlatformDemandInput = {
    deals: deals.map((d) => ({ createdAt: d.createdAt, postcodeArea: d.property.postcodeArea })),
    enquiries: intake.map((c) => c.createdAt),
    pageAttention,
    ...(pageAttentionLatest !== undefined ? { pageAttentionLatest } : {}),
    activeBuyBoxes: buyBoxes.filter((b) => b.active).length,
    now,
  };

  const candidates = buildPlatformCandidates(input);
  return { feedConnected: candidates.length > 0, candidates };
}

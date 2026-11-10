import { scoreObservationSource, type ScoredOpportunity } from "@backend/trend/service";
import { platformObservationSource } from "@backend/trend/platformSignals";
import {
  resolveEffectiveBrief,
  type BriefChannel,
  type EffectiveBrief,
  type GrowthBrief,
} from "@shared/domain/trend/brief";

/**
 * Trend Intelligence — the invisible control layer (spec §1, §4).
 *
 * The engine is not a page. It runs headlessly over LODE's real demand and
 * produces Growth Briefs that the EXISTING agents resolve at run time — the spec
 * is explicit that this is "a control layer for existing agents", changing their
 * priorities through a versioned brief, not a separate product with its own
 * surface. `effectiveBriefFor` is that run-time resolver (the §4 SDK): an agent
 * asks for the brief that applies to its channel/market/locale/topic, and gets
 * the approved one or a baseline. A stale or missing brief always resolves to
 * baseline, so the brief can never be the authority for a write it should not be
 * (TI-05).
 *
 * Nothing here is user-visible. The trend cron calls `platformBriefing` on a
 * schedule and records the result to the append-only audit trail; agents call
 * `effectiveBriefFor` when they run. Both are background mechanisms.
 */

export interface PlatformBriefing {
  readonly opportunities: readonly ScoredOpportunity[];
  /** The eligible Growth Briefs produced this run (decision === brief/auto). */
  readonly briefs: readonly GrowthBrief[];
  readonly computedAt: string;
}

/** Run the engine over LODE's real demand and collect the eligible briefs. */
export async function platformBriefing(now: Date = new Date()): Promise<PlatformBriefing> {
  const source = await platformObservationSource(now);
  const opportunities = scoreObservationSource(source, now);
  const briefs = opportunities
    .map((o) => o.brief)
    .filter((b): b is GrowthBrief => b !== undefined);
  return { opportunities, briefs, computedAt: now.toISOString() };
}

export interface EffectiveBriefQuery {
  readonly market: string;
  readonly locale: string;
  readonly topicId: string;
  readonly channel: BriefChannel;
}

/**
 * The run-time resolver existing agents call (spec §4/§14). Finds the current
 * eligible brief for the requested scope and resolves it — returning the active
 * brief only when it is live and matches scope and channel, otherwise baseline.
 * Agents pass the returned claims and audience as data alongside their existing
 * instructions; they never use it as authority to write.
 */
export async function effectiveBriefFor(query: EffectiveBriefQuery, now: Date = new Date()): Promise<EffectiveBrief> {
  const { briefs } = await platformBriefing(now);
  const candidate = briefs.find(
    (b) => b.market === query.market && b.locale === query.locale && b.topic_id === query.topicId,
  );
  return resolveEffectiveBrief(
    candidate,
    { market: query.market, locale: query.locale, topic_id: query.topicId, channel: query.channel },
    now,
  );
}

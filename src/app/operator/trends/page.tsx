import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader, Panel, Badge, Stat, KeyValue } from "@/app/components/chrome";
import { requirePermission } from "@/app/operator/guard";
import { trendConsole, round1, type ScoredOpportunity } from "@backend/trend/service";
import { fixturesEnabled } from "@backend/trend/fixtureSource";
import type { TrendDecision } from "@shared/domain/trend/scoring";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trend Intelligence — Lode" };

/** DealProp is single-tenant, so the installation boundary is one fixed id. */
const INSTALLATION_ID = "lode-default";

const DECISION_LABEL: Record<TrendDecision, string> = {
  archive: "Archive",
  watch: "Watch — internal only",
  brief: "Reviewable brief",
  auto: "Eligible for bounded auto",
};

/** Decision state is not a red/amber/green verdict, so it stays neutral/accent. */
function decisionTone(decision: TrendDecision): "neutral" | "accent" {
  return decision === "brief" || decision === "auto" ? "accent" : "neutral";
}

function OpportunityCard({ item }: { item: ScoredOpportunity }) {
  const { candidate, scored, movement, brief } = item;
  const o = candidate.profile;
  return (
    <Panel
      className="mt-6"
      eyebrow={`${candidate.platformId} · ${candidate.market}/${candidate.locale}`}
      title={candidate.topicLabel}
      action={<Badge tone={decisionTone(scored.decision)}>{DECISION_LABEL[scored.decision]}</Badge>}
    >
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        <Stat label="Opportunity" value={round1(scored.opportunityScore).toString()} note="0–100" size="lg" />
        <Stat label="Confidence" value={round1(scored.confidence).toString()} note={scored.confidenceCapped ? "capped at 69: one family" : `${scored.independentFamilies} independent families`} size="lg" />
        <Stat label="Anomaly z" value={round1(movement.z).toString()} note={movement.gatePassed ? "gate passed" : "gate not met"} />
        <Stat label="Demand" value={round1(movement.demandScore).toString()} note="from detection" />
      </div>

      <h3 className="eyebrow mt-6">Opportunity breakdown</h3>
      <div className="mt-2 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        <KeyValue k="Demand (25%)" v={round1(movement.demandScore).toString()} />
        <KeyValue k="Platform fit (25%)" v={o.fit.toString()} />
        <KeyValue k="Commercial intent (20%)" v={o.intent.toString()} />
        <KeyValue k="Timing (15%)" v={o.timing.toString()} />
        <KeyValue k="Readiness (15%)" v={o.readiness.toString()} />
      </div>

      {scored.vetoes.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-ink-400">Vetoes block live activation:</span>
          {scored.vetoes.map((v) => (
            <Badge key={v} tone="warn">
              {v}
            </Badge>
          ))}
        </div>
      )}

      <h3 className="eyebrow mt-6">Why</h3>
      <ul className="mt-2 space-y-1.5">
        {scored.reasons.map((r, i) => (
          <li key={i} className="border-l-2 border-[color:var(--accent)] py-0.5 pl-3 text-[13px] leading-relaxed text-ink-300">
            {r}
          </li>
        ))}
      </ul>

      {brief !== undefined ? (
        <div className="mt-6 rounded-lg border hairline bg-surface-2 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="eyebrow">Growth Brief draft</h3>
            <Badge tone="accent">{brief.brief_id}</Badge>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <KeyValue k="Audience" v={brief.audience} />
            <KeyValue k="Intent" v={brief.intent} />
            <KeyValue k="Objective" v={brief.objective} />
            <KeyValue k="Channels" v={brief.allowed_channels.join(", ")} />
            <KeyValue k="CTA" v={brief.cta_id} />
            <KeyValue k="Valid" v={`${brief.valid_from} → ${brief.expires_at}`} />
            <KeyValue k="Evidence" v={brief.evidence_ids.join(", ")} />
            <KeyValue k="Approved claims" v={brief.approved_claim_ids.join(", ") || "—"} />
          </div>
          {brief.prohibited_claims.length > 0 && (
            <p className="mt-3 text-[12px] leading-relaxed text-ink-500">
              Prohibited: {brief.prohibited_claims.join("; ")}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-6 border-l-2 border-ink-700 py-1 pl-4 text-[13px] text-ink-400">
          No brief: this opportunity is not eligible for one (needs score ≥ 75, confidence ≥ 75 and no veto).
        </p>
      )}
    </Panel>
  );
}

/**
 * Trend Intelligence — the operator console (spec §8 admin UI, §21 TI-16/TI-21).
 *
 * The deterministic engine runs over the installation's observations and shows
 * scored opportunities with their breakdown, decision and — where eligible — a
 * validated Growth Brief draft. With no connected feed the list is empty and
 * this shows the honest coverage boundary, exactly like Deal Hunt. No model is
 * called; nothing here is a live figure dressed up — the numbers are the
 * engine's output over whatever observations are present.
 */
export default async function TrendsPage() {
  await requirePermission("view-audit-log", "/operator/trends");
  const view = trendConsole(INSTALLATION_ID);

  return (
    <main data-accent="cyan" className="min-h-screen pb-24">
      <SiteHeader trailing={<OperatorNav current="/operator/trends" />} />
      <div className="mx-auto max-w-4xl px-6 py-10">
        <span className="eyebrow">Growth Intelligence</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          Trend Intelligence
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          A trend reader scores a change in demand, a strategist checks whether the platform can serve
          it, and an eligible opportunity produces a shared, time-limited Growth Brief for the SEO and
          marketing agents. Deterministic: every score is the engine's, and a reviewable brief needs a
          score and confidence of 75 with no veto.
        </p>

        {!view.feedConnected ? (
          <Panel className="mt-8" eyebrow="Coverage boundary" title="No signal feed connected">
            <p className="text-sm leading-relaxed text-ink-300">
              This installation has no connected signal feed, so there are no observations to score and
              the console shows an explicit empty state rather than an invented opportunity. Data is
              gated at the source, not the screen.
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-400">
              Set <code className="font-mono text-[12px] text-ink-300">TREND_FIXTURES=1</code> for a
              staff pilot over a small, clearly-synthetic candidate set, to exercise the real detection,
              scoring and brief-generation path against known data.
            </p>
          </Panel>
        ) : (
          <>
            <p className="mt-6 border-l-2 border-[color:var(--accent)] py-1 pl-4 text-[13px] leading-relaxed text-ink-400">
              Staff-pilot fixtures are enabled ({fixturesEnabled() ? "TREND_FIXTURES=1" : ""}). These are
              clearly-synthetic candidates for exercising the engine, never live demand.
            </p>
            {view.opportunities.map((item) => (
              <OpportunityCard key={`${item.candidate.platformId}:${item.candidate.topicId}`} item={item} />
            ))}
          </>
        )}
      </div>
    </main>
  );
}

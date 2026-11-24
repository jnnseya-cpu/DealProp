import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader, Panel, Badge, Stat, KeyValue } from "@/app/components/chrome";
import { requirePermission } from "@/app/operator/guard";
import { landFinder } from "@backend/land/service";
import { landFixturesEnabled } from "@backend/land/source";
import { landSourcing, type SourcedSite } from "@backend/land/sourcingService";
import { landDisposals } from "@backend/land/disposalsService";
import type { LandDisposal } from "@shared/domain/land/disposals";
import type { LandAssessment, RiskBand } from "@shared/domain/land/sourcing";
import type { ControlStructure } from "@shared/domain/land/types";

function gbp(n: number): string {
  return `£${Math.round(n).toLocaleString("en-GB")}`;
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Land Finder — Lode" };

const STRUCTURE_LABEL: Record<ControlStructure, string> = {
  "direct-purchase": "Direct purchase",
  option: "Option",
  "conditional-contract": "Conditional contract",
  "promotion-agreement": "Promotion agreement",
};

const ROUTE_LABEL: Record<string, string> = {
  "agent-or-auction": "Agent / auction",
  "owner-approach": "Off-market owner approach",
  blocked: "Blocked",
};

/** Risk band is a verdict, so only the genuine block takes the reserved red. */
function riskTone(band: RiskBand): "neutral" | "accent" | "bad" {
  if (band === "blocked") return "bad";
  if (band === "ready") return "accent";
  return "neutral";
}

function SiteCard({ a }: { a: LandAssessment }) {
  const s = a.site;
  return (
    <Panel
      className="mt-6"
      eyebrow={`${s.postcodeArea} · ${s.areaHectares} ha · ${s.currentUse}`}
      title={s.locality}
      action={<Badge tone={riskTone(a.riskBand)}>{a.riskBand}</Badge>}
    >
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        <Stat label="Sourceability" value={a.sourceabilityScore.toString()} note="0–100" size="lg" />
        <Stat label="Potential" value={a.potential.units.toString()} note={a.potential.fromConsent ? "consented" : "indicative units"} size="lg" />
        <Stat label="Planning" value={s.planningStatus} note="status" />
        <Stat label="Route" value={ROUTE_LABEL[a.route] ?? a.route} note="how to reach it" />
      </div>

      <h3 className="eyebrow mt-6">Control structures</h3>
      {a.structures.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {a.structures.map((st) => (
            <Badge key={st} tone="accent">
              {STRUCTURE_LABEL[st]}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-ink-400">No viable structure — the site is blocked as it stands.</p>
      )}

      {a.vetoes.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-ink-400">Hard constraints:</span>
          {a.vetoes.map((v) => (
            <Badge key={v} tone="warn">
              {v}
            </Badge>
          ))}
        </div>
      )}

      <h3 className="eyebrow mt-6">Why</h3>
      <ul className="mt-2 space-y-1.5">
        {a.reasons.map((r, i) => (
          <li key={i} className="border-l-2 border-[color:var(--accent)] py-0.5 pl-3 text-[13px] leading-relaxed text-ink-300">
            {r}
          </li>
        ))}
      </ul>

      <div className="mt-5 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        <KeyValue k="Net developable" v={`${a.potential.netDevelopableHectares} ha`} />
        <KeyValue k="Density band" v={`${a.potential.densityPerHectare} dph (${s.settlement})`} />
        <KeyValue k="Owner known" v={s.ownerKnown ? "yes (title read)" : "no — needs HMLR title read"} />
        <KeyValue k="Marketed" v={s.openlyMarketed ? "openly marketed" : "off-market"} />
      </div>
    </Panel>
  );
}

/** A sourced development-land opportunity from the Brownfield Land Registers. */
function OpportunityCard({ s }: { s: SourcedSite }) {
  const { opportunity: o, assessment: a } = s;
  const capacity =
    o.minUnits !== undefined && o.maxUnits !== undefined
      ? `${o.minUnits}–${o.maxUnits}`
      : o.maxUnits !== undefined
        ? `${o.maxUnits}`
        : "—";
  return (
    <Panel
      className="mt-6"
      eyebrow={`${o.postcode ?? "no postcode"} · ${o.areaHectares} ha · brownfield`}
      title={o.name}
      action={<Badge tone={riskTone(a.riskBand)}>{a.riskBand}</Badge>}
    >
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        <Stat label="Sourceability" value={a.sourceabilityScore.toString()} note="0–100" size="lg" />
        <Stat label="Register capacity" value={capacity} note="units (LPA estimate)" size="lg" />
        <Stat label="Planning" value={o.planningStatus} note="status" />
        <Stat
          label="Ownership"
          value={o.ownershipPublic ? "Public" : "Private"}
          note={o.deliverable === true ? "deliverable" : o.deliverable === false ? "not deliverable" : "—"}
        />
      </div>

      <h3 className="eyebrow mt-6">Control structures</h3>
      {a.structures.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {a.structures.map((st) => (
            <Badge key={st} tone="accent">
              {STRUCTURE_LABEL[st]}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-ink-400">No viable structure — blocked as it stands.</p>
      )}

      {a.vetoes.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-ink-400">Hard constraints:</span>
          {a.vetoes.map((v) => (
            <Badge key={v} tone="warn">
              {v}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        <KeyValue k="Register reference" v={o.reference} />
        <KeyValue k="Owner" v={o.ownershipPublic ? "Public authority — reachable" : "Private — needs HMLR title read"} />
        <KeyValue k="Engine estimate" v={`~${a.potential.units} units indicative (${o.areaHectares} ha)`} />
        {o.asOf !== "" ? <KeyValue k="Register entry" v={o.asOf} /> : <></>}
      </div>
    </Panel>
  );
}

/** A public-sector land/property disposal sourced from Contracts Finder. */
function DisposalCard({ d }: { d: LandDisposal }) {
  return (
    <Panel
      className="mt-6"
      accent="gold"
      eyebrow={`${d.authority}${d.region !== undefined ? ` · ${d.region}` : ""}`}
      title={d.title}
      action={d.deadline !== undefined ? <Badge tone="neutral">closes {d.deadline.slice(0, 10)}</Badge> : <></>}
    >
      {d.description !== "" && <p className="text-[13px] leading-relaxed text-ink-300">{d.description}</p>}
      <div className="mt-4 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {d.valueGbp !== undefined ? <KeyValue k="Guide / value" v={gbp(d.valueGbp)} /> : <KeyValue k="Guide / value" v="Price on application" />}
        {d.postcode !== undefined ? <KeyValue k="Postcode" v={d.postcode} /> : <></>}
        {d.published !== undefined ? <KeyValue k="Published" v={d.published.slice(0, 10)} /> : <></>}
        <KeyValue k="Matched on" v={d.matchedOn.join("; ") || "—"} />
      </div>
      <a
        className="mt-4 inline-block text-[13px] text-[color:var(--accent-text)] underline hover:opacity-80"
        href={d.url}
        target="_blank"
        rel="noreferrer"
      >
        View the notice on Contracts Finder →
      </a>
    </Panel>
  );
}

/**
 * Land Finder — the operator console (the sourcing side of the land spec).
 *
 * The deterministic engine assesses each candidate site for development
 * potential, viable control structure, sourcing route and a sourceability
 * score. With no connected planning/land feed the list is empty and this shows
 * the honest coverage boundary, exactly like Deal Hunt. No invented sites.
 */
export default async function LandPage() {
  await requirePermission("view-audit-log", "/operator/land");
  const view = await landFinder();
  const sourcing = await landSourcing();
  const disposals = landDisposals();

  return (
    <main data-accent="teal" className="min-h-screen pb-24">
      <SiteHeader trailing={<OperatorNav current="/operator/land" />} />
      <div className="mx-auto max-w-4xl px-6 py-10">
        <span className="eyebrow">Sourcing</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          Land Finder
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          Land with planning, and land without it that you secure by option, conditional contract or
          promotion agreement. Each candidate site is assessed for what could be built, which structure
          fits, how to reach it, and a sourceability score — a green-belt or flood-zone site is a
          blocked prospect, never a cheap one.
        </p>

        {/* The real "find me sites" feed: the national Brownfield Land Registers. */}
        <h2 className="mt-10 font-display text-[20px] text-ink-100">Development sites</h2>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-400">
          Sourced from the national Brownfield Land Registers (planning.data.gov.uk, Open Government
          Licence) — previously-developed sites each authority has judged suitable for housing, with the
          authority&rsquo;s own dwelling capacity. Ranked by the same sourceability score, with every
          figure&rsquo;s provenance shown. The register&rsquo;s capacity is the LPA&rsquo;s; the engine
          estimate is ours.
        </p>
        {sourcing.sites.length === 0 ? (
          <Panel className="mt-6" eyebrow="Coverage boundary" title={sourcing.feedConnected ? "Live register returned no sites" : "No register feed connected"}>
            {sourcing.error !== undefined ? (
              <p className="text-sm leading-relaxed text-ink-300">
                The live register could not be read ({sourcing.error}). This is shown as unknown coverage, not
                as &ldquo;no sites in the region&rdquo; — a feed gap is never a false empty.
              </p>
            ) : sourcing.feedConnected ? (
              <p className="text-sm leading-relaxed text-ink-300">
                The feed is enabled but the store holds no brownfield sites yet. Trigger the load with an
                authenticated <code className="font-mono text-[12px] text-ink-300">POST /api/cron/brownfield</code>{" "}
                (CRON_SECRET) — it loads the national register from inside the running app — or{" "}
                <code className="font-mono text-[12px] text-ink-300">npm run load:brownfield</code> in a full
                checkout. Then this fills.
              </p>
            ) : (
              <p className="text-sm leading-relaxed text-ink-300">
                No brownfield register feed is connected, so there are no sourced sites and this shows an
                explicit empty state rather than an invented one — data gated at the source, not the screen.
              </p>
            )}
            <p className="mt-3 text-[13px] leading-relaxed text-ink-400">
              <code className="font-mono text-[12px] text-ink-300">BROWNFIELD_LIVE=1</code> reads the loaded
              national register from the store;{" "}
              <code className="font-mono text-[12px] text-ink-300">LAND_SOURCING_FIXTURES=1</code> serves the
              staff pilot. The feed is licensed (OGL) and free.
            </p>
          </Panel>
        ) : (
          <>
            {sourcing.feedConnected && (
              <p className="mt-6 border-l-2 border-[color:var(--accent)] py-1 pl-4 text-[13px] leading-relaxed text-ink-400">
                Live national feed (BROWNFIELD_LIVE=1): top {sourcing.sites.length} by sourceability
                {sourcing.total !== undefined ? ` of ${sourcing.total.toLocaleString("en-GB")} loaded` : ""}.
              </p>
            )}
            {sourcing.pilot && (
              <p className="mt-6 border-l-2 border-[color:var(--accent)] py-1 pl-4 text-[13px] leading-relaxed text-ink-400">
                Staff-pilot fixtures enabled (LAND_SOURCING_FIXTURES=1). Clearly-synthetic register entries,
                mapped through the live connector&rsquo;s own mapper, never real prospects.
              </p>
            )}
            {sourcing.sites.map((s) => (
              <OpportunityCard key={s.opportunity.id} s={s} />
            ))}
          </>
        )}

        {/* Live public-sector disposals: the "for sale now" feed. */}
        <h2 className="mt-12 font-display text-[20px] text-ink-100">Live disposals</h2>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-400">
          Councils and public bodies advertising land and property for sale, sourced from Contracts Finder
          (Open Government Licence). Only genuine disposals and development opportunities are shown — the
          classifier filters out the far larger volume of services procurement, and states what each notice
          matched on. Soonest deadline first.
        </p>
        {disposals.disposals.length === 0 ? (
          <Panel className="mt-6" eyebrow="Coverage boundary" title="No disposals feed connected">
            <p className="text-sm leading-relaxed text-ink-300">
              No Contracts Finder feed is connected, so there are no live disposals and this shows an
              explicit empty state — data gated at the source, not the screen.
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-400">
              Set <code className="font-mono text-[12px] text-ink-300">DISPOSALS_FIXTURES=1</code> for a staff
              pilot. Live sourcing waits on verifying the Contracts Finder search query against one real
              request — the feed is licensed (OGL) and free; the query shape is the open item.
            </p>
          </Panel>
        ) : (
          <>
            {disposals.pilot && (
              <p className="mt-6 border-l-2 border-[color:var(--accent)] py-1 pl-4 text-[13px] leading-relaxed text-ink-400">
                Staff-pilot fixtures enabled (DISPOSALS_FIXTURES=1). Synthetic notices run through the live
                connector&rsquo;s own classifier — note the services procurement is filtered out, not shown.
              </p>
            )}
            {disposals.disposals.map((d) => (
              <DisposalCard key={d.id} d={d} />
            ))}
          </>
        )}

        <h2 className="mt-12 font-display text-[20px] text-ink-100">Assessed candidate sites</h2>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-400">
          Sites entered or imported directly (the manual finder half), each run through the same engine.
        </p>

        {!view.feedConnected ? (
          <Panel className="mt-8" eyebrow="Coverage boundary" title="No land feed connected">
            <p className="text-sm leading-relaxed text-ink-300">
              This deployment has no connected planning/land feed, so there are no candidate sites to
              assess and the finder shows an explicit empty state rather than an invented site. Data is
              gated at the source, not the screen.
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-400">
              Set <code className="font-mono text-[12px] text-ink-300">LAND_FIXTURES=1</code> for a staff
              pilot over a small, clearly-synthetic set, to exercise the assessment engine. Live sourcing
              waits on a licensed planning feed and the HM Land Registry title read — procurement, not code.
            </p>
          </Panel>
        ) : (
          <>
            <p className="mt-6 border-l-2 border-[color:var(--accent)] py-1 pl-4 text-[13px] leading-relaxed text-ink-400">
              Staff-pilot fixtures enabled ({landFixturesEnabled() ? "LAND_FIXTURES=1" : ""}). Clearly-synthetic
              sites for exercising the engine, never real prospects.
            </p>
            {view.assessments.map((a) => (
              <SiteCard key={a.site.id} a={a} />
            ))}
          </>
        )}
      </div>
    </main>
  );
}

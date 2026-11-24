import { Panel, Badge, Stat, KeyValue } from "@/app/components/chrome";
import type { SourcedSite, AcquisitionView } from "@backend/land/sourcingService";
import type { LandDisposal } from "@shared/domain/land/disposals";
import type { RiskBand } from "@shared/domain/land/sourcing";
import type { ControlStructure } from "@shared/domain/land/types";

/**
 * Shared land-sourcing views.
 *
 * The operator console (/operator/land) and the investor surface (/invest/land)
 * render the SAME cards from here, so the two cannot drift — exactly as the Deal
 * Hunt surfaces share `components/hunt/`. The pages differ only in their guards,
 * navigation and empty-state copy.
 */

const STRUCTURE_LABEL: Record<ControlStructure, string> = {
  "direct-purchase": "Direct purchase",
  option: "Option",
  "conditional-contract": "Conditional contract",
  "promotion-agreement": "Promotion agreement",
};

const CODE_LABEL: Record<string, string> = {
  "green-belt": "Green belt",
  "flood-zone-3": "Flood zone 3",
  "flood-zone-2": "Flood zone 2",
  sssi: "SSSI",
  aonb: "AONB",
  "conservation-area": "Conservation area",
  "listed-building": "Listed building",
  "ancient-woodland": "Ancient woodland",
  tpo: "TPO",
  "contaminated-land": "Contaminated land",
  "no-access": "No road access",
  "ransom-strip": "Ransom strip",
  "no-services": "No services",
  "covenant-restriction": "Restrictive covenant",
};

export function codeLabel(code: string): string {
  return CODE_LABEL[code] ?? code;
}

/** Risk band is a verdict, so only the genuine block takes the reserved red. */
export function riskTone(band: RiskBand): "neutral" | "accent" | "bad" {
  if (band === "blocked") return "bad";
  if (band === "ready") return "accent";
  return "neutral";
}

export function gbp(n: number): string {
  return `£${Math.round(n).toLocaleString("en-GB")}`;
}

/** The council's domain from a register/site-plan URL, as a contact starting point. */
function councilHost(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

const VIEW_TABS: ReadonlyArray<{ key: AcquisitionView; label: string }> = [
  { key: "all", label: "All" },
  { key: "buy", label: "To buy (consented)" },
  { key: "secure", label: "To secure (option / promotion)" },
];

/** The acquisition-approach filter, parameterised by the surface's base path. */
export function AcquisitionTabs({ basePath, current }: { basePath: string; current: AcquisitionView }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {VIEW_TABS.map((tab) => (
        <a
          key={tab.key}
          href={tab.key === "all" ? basePath : `${basePath}?view=${tab.key}`}
          className={`rounded-md border px-3 py-1.5 text-[13px] ${
            current === tab.key
              ? "border-[color:var(--accent)] bg-surface-2 text-ink-100"
              : "hairline bg-surface-1 text-ink-400 hover:text-ink-200"
          }`}
        >
          {tab.label}
        </a>
      ))}
    </div>
  );
}

/** A sourced development-land opportunity from the Brownfield Land Registers. */
export function OpportunityCard({ s }: { s: SourcedSite }) {
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
      eyebrow={`${o.postcode !== undefined ? `${o.postcode} · ` : ""}${o.areaHectares} ha · brownfield`}
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
            <Badge key={st} tone="accent">{STRUCTURE_LABEL[st]}</Badge>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-ink-400">No viable structure — blocked as it stands.</p>
      )}

      {a.vetoes.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-ink-400">Hard constraints:</span>
          {a.vetoes.map((v) => (<Badge key={v} tone="warn">{codeLabel(v)}</Badge>))}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        <KeyValue k="Register reference" v={o.reference} />
        <KeyValue k="Engine estimate" v={`~${a.potential.units} units indicative (${o.areaHectares} ha)`} />
        {o.asOf !== "" ? <KeyValue k="Register entry" v={o.asOf} /> : <></>}
      </div>

      <h3 className="eyebrow mt-6">How to pursue</h3>
      {o.ownershipPublic ? (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-300">
          Owned by the council{councilHost(o.sitePlanUrl) !== undefined ? ` (${councilHost(o.sitePlanUrl)})` : ""} —
          pursue it through their property / estates / regeneration team, not a private owner. Register your
          interest and ask about disposal timing for this reference. Councils must sell at best value, so a
          sale is run as a formal, usually-advertised process (tender, auction or agent) — so watch the Live
          disposals feed, which catches the council&rsquo;s notice on Contracts Finder when it goes to market.
        </p>
      ) : (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-300">
          Privately owned. The owner and their address for service come from an HM Land Registry title read,
          then an approach by letter through the licensed owner-outreach path (PECR-compliant, letter-only).
        </p>
      )}
      {o.sitePlanUrl !== undefined && (
        <a
          className="mt-2 inline-block text-[13px] text-[color:var(--accent-text)] underline hover:opacity-80"
          href={o.sitePlanUrl}
          target="_blank"
          rel="noreferrer"
        >
          Council register entry / site plan →
        </a>
      )}
    </Panel>
  );
}

/** A public-sector land/property disposal sourced from Contracts Finder. */
export function DisposalCard({ d }: { d: LandDisposal }) {
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

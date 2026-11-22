import { redirect } from "next/navigation";
import { AccountNav } from "@/app/account/AccountNav";
import { SiteHeader, Panel, Badge, Stat, KeyValue, Button } from "@/app/components/chrome";
import { currentViewer } from "@/app/operator/guard";
import { assessSiteFromInput } from "@backend/land/assess";
import { DECLARABLE_CONSTRAINTS } from "@shared/domain/land/input";
import type { LandAssessment, RiskBand } from "@shared/domain/land/sourcing";
import type { ControlStructure } from "@shared/domain/land/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assess a site — Lode" };

const STRUCTURE_LABEL: Record<ControlStructure, string> = {
  "direct-purchase": "Direct purchase",
  option: "Option",
  "conditional-contract": "Conditional contract",
  "promotion-agreement": "Promotion agreement",
};

function riskTone(band: RiskBand): "neutral" | "accent" | "bad" {
  if (band === "blocked") return "bad";
  if (band === "ready") return "accent";
  return "neutral";
}

const USE_OPTIONS = ["agricultural", "paddock", "brownfield", "garden", "employment", "vacant"];
const SETTLEMENT_OPTIONS = ["urban", "suburban", "edge-of-settlement", "rural"];
const PLANNING_OPTIONS = ["none", "pre-application", "allocated", "outline", "reserved-matters", "full", "lapsed", "refused"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium uppercase tracking-[0.08em] text-ink-400">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-md border hairline bg-surface-2 px-3 py-2 text-sm text-ink-100 focus:border-ink-500 focus:outline-none";

function Result({ a }: { a: LandAssessment }) {
  return (
    <Panel className="mt-8" eyebrow="Verdict" title={a.site.locality} action={<Badge tone={riskTone(a.riskBand)}>{a.riskBand}</Badge>}>
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        <Stat label="Sourceability" value={a.sourceabilityScore.toString()} note="0–100" size="lg" />
        <Stat label="Potential" value={a.potential.units.toString()} note={a.potential.fromConsent ? "consented" : "indicative units"} size="lg" />
        <Stat label="Planning" value={a.site.planningStatus} note="status" />
        <Stat label="Route" value={a.route === "agent-or-auction" ? "Agent / auction" : a.route === "owner-approach" ? "Owner approach" : "Blocked"} note="how to reach it" />
      </div>

      <h3 className="eyebrow mt-6">What you can do with it</h3>
      {a.structures.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {a.structures.map((s) => (
            <Badge key={s} tone="accent">{STRUCTURE_LABEL[s]}</Badge>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-ink-400">Nothing viable — the site is blocked as it stands.</p>
      )}

      {a.vetoes.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-ink-400">Blocked by:</span>
          {a.vetoes.map((v) => (<Badge key={v} tone="warn">{v}</Badge>))}
        </div>
      )}

      <h3 className="eyebrow mt-6">Why</h3>
      <ul className="mt-2 space-y-1.5">
        {a.reasons.map((r, i) => (
          <li key={i} className="border-l-2 border-[color:var(--accent)] py-0.5 pl-3 text-[13px] leading-relaxed text-ink-300">{r}</li>
        ))}
      </ul>

      <div className="mt-5 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        <KeyValue k="Net developable" v={`${a.potential.netDevelopableHectares} ha`} />
        <KeyValue k="Density band" v={`${a.potential.densityPerHectare} dph (${a.site.settlement})`} />
      </div>
    </Panel>
  );
}

function asStrings(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function AssessSitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await currentViewer();
  if (viewer === undefined) redirect("/operator?next=%2Faccount%2Fland");

  const sp = await searchParams;
  const submitted = typeof sp.postcode === "string" && sp.postcode.trim() !== "";

  const result = submitted
    ? await assessSiteFromInput({
        postcode: typeof sp.postcode === "string" ? sp.postcode : "",
        locality: typeof sp.locality === "string" ? sp.locality : undefined,
        acres: typeof sp.acres === "string" ? sp.acres : undefined,
        use: typeof sp.use === "string" ? sp.use : undefined,
        settlement: typeof sp.settlement === "string" ? sp.settlement : undefined,
        planning: typeof sp.planning === "string" ? sp.planning : undefined,
        units: typeof sp.units === "string" ? sp.units : undefined,
        constraints: asStrings(sp.constraints),
      })
    : undefined;

  return (
    <main data-accent="teal" className="min-h-screen pb-24">
      <SiteHeader trailing={<AccountNav current="/account/land" />} />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <span className="eyebrow">Land</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">Assess a site</h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          Got a plot in mind — a field you drove past, a site an agent mentioned? Enter what you know and
          LODE tells you, before you spend a penny on a title read or a solicitor: is it developable, how
          many units, which structure fits, and whether it is worth pursuing. We check the national planning
          map for green belt, flood risk and designations.
        </p>

        <form method="get" className="mt-8 space-y-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Postcode">
              <input name="postcode" required placeholder="e.g. CV8 1AA" defaultValue={typeof sp.postcode === "string" ? sp.postcode : ""} className={inputClass} />
            </Field>
            <Field label="Nearby place (optional)">
              <input name="locality" placeholder="e.g. Kenilworth" defaultValue={typeof sp.locality === "string" ? sp.locality : ""} className={inputClass} />
            </Field>
            <Field label="Site size (acres)">
              <input name="acres" type="number" step="0.1" min="0" required placeholder="e.g. 3" defaultValue={typeof sp.acres === "string" ? sp.acres : ""} className={inputClass} />
            </Field>
            <Field label="Consented units (if any)">
              <input name="units" type="number" min="0" placeholder="leave blank if no consent" defaultValue={typeof sp.units === "string" ? sp.units : ""} className={inputClass} />
            </Field>
            <Field label="Current use">
              <select name="use" defaultValue={typeof sp.use === "string" ? sp.use : "agricultural"} className={inputClass}>
                {USE_OPTIONS.map((o) => (<option key={o} value={o}>{o}</option>))}
              </select>
            </Field>
            <Field label="Setting">
              <select name="settlement" defaultValue={typeof sp.settlement === "string" ? sp.settlement : "edge-of-settlement"} className={inputClass}>
                {SETTLEMENT_OPTIONS.map((o) => (<option key={o} value={o}>{o}</option>))}
              </select>
            </Field>
            <Field label="Planning status">
              <select name="planning" defaultValue={typeof sp.planning === "string" ? sp.planning : "none"} className={inputClass}>
                {PLANNING_OPTIONS.map((o) => (<option key={o} value={o}>{o}</option>))}
              </select>
            </Field>
          </div>

          <fieldset>
            <legend className="mb-2 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-400">Known designations (tick any you know of)</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {Object.entries(DECLARABLE_CONSTRAINTS).map(([key, c]) => (
                <label key={key} className="flex items-center gap-2 text-[13px] text-ink-300">
                  <input type="checkbox" name="constraints" value={key} defaultChecked={asStrings(sp.constraints).includes(key)} />
                  {c.label}
                </label>
              ))}
            </div>
          </fieldset>

          <Button variant="primary" type="submit">Assess the site</Button>
        </form>

        {result !== undefined && (
          <>
            {result.errors.length > 0 && (
              <ul className="mt-6 space-y-1">
                {result.errors.map((e, i) => (
                  <li key={i} className="border-l-2 border-red-500/80 py-1 pl-3 text-sm text-red-300">{e}</li>
                ))}
              </ul>
            )}
            {result.assessment !== undefined && (
              <>
                <Result a={result.assessment} />
                {result.notes.length > 0 && (
                  <p className="mt-3 border-l-2 border-ink-700 py-1 pl-4 text-[12px] leading-relaxed text-ink-500">
                    {result.notes.join(" ")}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

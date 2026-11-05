import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader, Panel, Badge, Stat } from "@/app/components/chrome";
import { requirePermission } from "@/app/operator/guard";
import { listLayoutHypotheses, listAuctionLots } from "@backend/store/repository";
import { canCreateScenario } from "@shared/domain/floorplan";
import { assessAuctionLot } from "@shared/domain/auction";
import { gbp } from "@shared/format";
import { recordFloorplanAction, recordAuctionAction } from "@/app/operator/specialist/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Specialist analysis — Lode" };

/**
 * Specialist analysis (Independent AI Deal Engine §2/§4, IND10/IND11).
 *
 * Floorplan hypotheses and auction follow-up for a property. A floorplan is a
 * hypothesis, never a fact — an unscaled plan asserts no dimensions and cannot
 * seed a scenario until a reviewer resolves scale, circulation, access and
 * planning. An auction lot's availability stays unverified until confirmed, and
 * only confirmed charges carry into an appraisal.
 */

export default async function SpecialistPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string }>;
}) {
  await requirePermission("view-audit-log", "/operator/specialist");
  const sp = await searchParams;
  const property = typeof sp.property === "string" ? sp.property : "";
  const hypotheses = property !== "" ? await listLayoutHypotheses(property) : [];
  const lots = property !== "" ? await listAuctionLots(property) : [];
  const now = new Date();

  return (
    <main data-accent="indigo" className="min-h-screen pb-24">
      <SiteHeader trailing={<OperatorNav current="/operator/specialist" />} />
      <div className="mx-auto max-w-4xl px-6 py-10">
        <span className="eyebrow">Specialist analysis</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-tight text-ink-100 sm:text-[32px]">
          Floorplan &amp; auction
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-300">
          A floorplan is a hypothesis until a reviewer confirms scale and feasibility; an auction
          lot&rsquo;s availability is unverified until confirmed. Enter a property reference to record
          and review both.
        </p>

        <form method="get" className="mt-6 flex items-end gap-2">
          <div className="flex-1">
            <label className="text-[11px] font-medium uppercase tracking-[0.09em] text-ink-400">Property reference</label>
            <input
              name="property"
              defaultValue={property}
              placeholder="property id or reference"
              className="mt-1 w-full rounded-md border hairline bg-surface-2 px-2 py-1.5 text-sm text-ink-100 placeholder:text-ink-600"
            />
          </div>
          <button type="submit" className="h-9 rounded-md border hairline bg-surface-2 px-3 text-sm text-ink-100 hover:border-ink-600 hover:bg-surface-3">
            Load
          </button>
        </form>

        {property !== "" && (
          <>
            {/* Floorplan */}
            <Panel className="mt-8" eyebrow="Floorplan (IND10)" title="Layout hypotheses">
              <form action={recordFloorplanAction} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="propertyId" value={property} />
                <Input label="Plan version" name="planVersion" placeholder="plan-1" />
                <Input label="Page" name="page" type="number" defaultValue="1" />
                <div className="sm:col-span-2">
                  <label className="text-[11px] font-medium uppercase tracking-[0.09em] text-ink-400">Proposed change</label>
                  <input name="proposedChange" required placeholder="Knock kitchen and dining through" className="mt-1 w-full rounded-md border hairline bg-surface-2 px-2 py-1.5 text-sm text-ink-100 placeholder:text-ink-600" />
                </div>
                <label className="flex items-center gap-2 text-[13px] text-ink-200 sm:col-span-2">
                  <input type="checkbox" name="scaleReadable" /> Scale bar is readable on the plan
                </label>
                <div className="sm:col-span-2">
                  <button type="submit" className="h-8 rounded-md border hairline bg-surface-2 px-3 text-[13px] text-ink-100 hover:border-ink-600 hover:bg-surface-3">Record hypothesis</button>
                </div>
              </form>

              <div className="mt-5 space-y-3">
                {hypotheses.length === 0 && <p className="text-sm text-ink-500">None recorded.</p>}
                {hypotheses.map((h) => {
                  const scenario = canCreateScenario(h, []);
                  return (
                    <div key={h.id} className="rounded-lg border hairline bg-surface-2 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Badge tone={h.dimensionsPermitted ? "good" : "warn"}>
                          {h.dimensionsPermitted ? "scale confirmed" : "unscaled — hypothesis only"}
                        </Badge>
                        <Badge tone="neutral">{h.confidence}</Badge>
                      </div>
                      <p className="mt-2 text-[13px] text-ink-200">{h.proposedChange}</p>
                      <p className="mt-1 text-[12px] text-ink-500">Unresolved: {h.unresolvedChecks.join(", ")}</p>
                      <p className="mt-1 text-[12px] text-ink-400">
                        Scenario: {scenario.ok ? "may be created" : `blocked on ${scenario.blocking.join(", ")}`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </Panel>

            {/* Auction */}
            <Panel className="mt-6" eyebrow="Auction (IND11)" title="Lots under follow-up">
              <form action={recordAuctionAction} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="propertyId" value={property} />
                <Input label="Guide price (£)" name="guideMajor" type="number" />
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-[0.09em] text-ink-400">Outcome</label>
                  <select name="outcome" defaultValue="unsold-confirmed" className="mt-1 w-full rounded-md border hairline bg-surface-2 px-2 py-1.5 text-sm text-ink-100">
                    <option value="advertised">Advertised</option>
                    <option value="unsold-confirmed">Unsold (confirmed)</option>
                    <option value="withdrawn">Withdrawn</option>
                    <option value="sold">Sold</option>
                    <option value="availability-unknown">Availability unknown</option>
                  </select>
                </div>
                <Input label="Buyer's premium (£)" name="premiumMajor" type="number" />
                <Input label="Availability confirmed (date)" name="availabilityConfirmedAt" type="date" />
                <label className="flex items-center gap-2 text-[13px] text-ink-200 sm:col-span-2">
                  <input type="checkbox" name="premiumConfirmed" /> Premium is confirmed from the legal pack
                </label>
                <div className="sm:col-span-2">
                  <button type="submit" className="h-8 rounded-md border hairline bg-surface-2 px-3 text-[13px] text-ink-100 hover:border-ink-600 hover:bg-surface-3">Record lot</button>
                </div>
              </form>

              <div className="mt-5 space-y-3">
                {lots.length === 0 && <p className="text-sm text-ink-500">None recorded.</p>}
                {lots.map((stored) => {
                  const a = assessAuctionLot(stored.lot, now);
                  return (
                    <div key={stored.id} className="rounded-lg border hairline bg-surface-2 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Badge tone={a.opportunityOpen ? "good" : "neutral"}>
                          {a.opportunityOpen ? "opportunity open" : "not pursuable"}
                        </Badge>
                        <Badge tone={a.availabilityVerified ? "good" : "warn"}>
                          {a.availabilityVerified ? "availability verified" : "unverified"}
                        </Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        {stored.lot.guidePence !== undefined && <Stat label="Guide" value={gbp(stored.lot.guidePence)} size="sm" />}
                        <Stat label="Confirmed charges" value={gbp(a.confirmedChargesPence)} size="sm" />
                      </div>
                      <p className="mt-2 text-[12px] text-ink-400">{a.note}</p>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </>
        )}
      </div>
    </main>
  );
}

function Input({
  label,
  name,
  type = "text",
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[11px] font-medium uppercase tracking-[0.09em] text-ink-400">{label}</label>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border hairline bg-surface-2 px-2 py-1.5 text-sm text-ink-100 placeholder:text-ink-600"
      />
    </div>
  );
}

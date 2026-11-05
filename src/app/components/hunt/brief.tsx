import { Button } from "@/app/components/chrome";
import type { CriteriaDraft } from "@shared/domain/dealHunt";

/**
 * The Deal Hunt brief and confirm forms, shared by the operator and investor
 * surfaces. `base` is the surface path; the brief form GETs back to it (so the
 * interpretation is a shareable URL) and the confirm form carries it to the run
 * action.
 */

export function HuntBrief({ brief, base }: { brief: string; base: string }) {
  return (
    <form method="get" action={base} className="mt-8">
      <label htmlFor="brief" className="text-[13px] font-medium text-ink-200">Your brief</label>
      <textarea
        id="brief"
        name="brief"
        rows={3}
        defaultValue={brief}
        placeholder="2–3 bed houses in Birmingham under £225,000 that returned to market in the last 30 days and dropped at least 5%"
        className="mt-2 w-full rounded-lg border hairline bg-surface-2 px-3 py-2.5 text-sm text-ink-100 placeholder:text-ink-600"
      />
      <div className="mt-2.5">
        <Button type="submit" variant="secondary">Interpret</Button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
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

export function HuntConfirmForm({
  brief,
  draft,
  action,
  base,
}: {
  brief: string;
  draft: CriteriaDraft;
  action: (formData: FormData) => void | Promise<void>;
  base: string;
}) {
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="brief" value={brief} />
      <input type="hidden" name="base" value={base} />
      <Field label="Geography ID" name="geographyId" defaultValue={draft.geographyId ?? ""} placeholder="pilot-birmingham" />
      <Field label="Property types (comma)" name="propertyTypes" defaultValue={(draft.propertyTypes ?? []).join(", ")} placeholder="house" />
      <Field label="Price ceiling (£)" name="priceCeilingMajor" type="number" defaultValue={draft.askingPriceLimitPence !== undefined ? String(Math.round(draft.askingPriceLimitPence / 100)) : ""} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Beds min" name="bedroomsMin" type="number" defaultValue={draft.bedroomsMin !== undefined ? String(draft.bedroomsMin) : ""} />
        <Field label="Beds max" name="bedroomsMax" type="number" defaultValue={draft.bedroomsMax !== undefined ? String(draft.bedroomsMax) : ""} />
      </div>
      <Field label="Returned within (days)" name="returnedWithinDays" type="number" defaultValue={String(draft.returnedWithinDays ?? 30)} />
      <Field label="Minimum drop (%)" name="minimumDropPercent" type="number" defaultValue={draft.minimumDropBps !== undefined ? String(draft.minimumDropBps / 100) : "0"} />
      <div>
        <label className="text-[11px] font-medium uppercase tracking-[0.09em] text-ink-400">Event</label>
        <select name="eventRequirement" defaultValue="returned_to_market" className="mt-1 w-full rounded-md border hairline bg-surface-2 px-2 py-1.5 text-sm text-ink-100">
          <option value="returned_to_market">Returned to market</option>
          <option value="confirmed_fall_through">Confirmed fall-through</option>
        </select>
      </div>
      <div>
        <label className="text-[11px] font-medium uppercase tracking-[0.09em] text-ink-400">Price operator</label>
        <select name="priceOperator" defaultValue="lt" className="mt-1 w-full rounded-md border hairline bg-surface-2 px-2 py-1.5 text-sm text-ink-100">
          <option value="lt">Under (strict)</option>
          <option value="lte">At or under</option>
        </select>
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" variant="primary">Run this hunt</Button>
      </div>
    </form>
  );
}

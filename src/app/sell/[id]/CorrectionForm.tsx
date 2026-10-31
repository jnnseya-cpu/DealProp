import { correctEnquiry } from "../actions";
import { allSituations, situationLabel } from "@shared/domain/motivation";
import type {
  PropertyFacts,
  PropertyIssue,
  SellerPriority,
  SellerProfile,
  SellerScreening,
  Tenure,
} from "@shared/domain/types";
import type { JurisdictionCode, PropertyType } from "@shared/domain/types";

/**
 * A seller correcting their own enquiry, with no account.
 *
 * The id in the hidden field is the capability — the seller holds it from their
 * result link — so posting this form is proof the enquiry is theirs. Everything
 * is pre-filled from what was saved and re-validated and re-appraised on submit
 * by the same engine the first submission used. The engine-derived figures (the
 * appraisal, the score, the routes) are never on the form: they are recomputed
 * from these answers, which is the whole point of correcting them.
 *
 * A server component: a pre-filled form that posts to a server action needs no
 * client JavaScript, so none is shipped.
 */

const PRIORITY_LABELS: Record<SellerPriority, string> = {
  speed: "Speed",
  certainty: "Certainty",
  price: "Best price",
  convenience: "Convenience",
  flexibility: "Flexibility",
};

const TYPE_LABELS: Record<PropertyType, string> = {
  house: "House",
  flat: "Flat",
  bungalow: "Bungalow",
  hmo: "HMO",
  commercial: "Commercial",
  "mixed-use": "Mixed use",
  land: "Land",
};

const TENURE_LABELS: Record<Tenure, string> = {
  freehold: "Freehold",
  leasehold: "Leasehold",
  "share-of-freehold": "Share of freehold",
  unknown: "Not sure",
};

const JURISDICTION_LABELS: Record<JurisdictionCode, string> = {
  "GB-ENG": "England",
  "GB-WLS": "Wales",
  "GB-SCT": "Scotland",
  "GB-NIR": "Northern Ireland",
  "US-GEN": "United States",
};

const CONDITIONS: readonly { value: string; label: string }[] = [
  { value: "ready", label: "Ready to live in" },
  { value: "tired", label: "Tired but liveable" },
  { value: "needs-modernising", label: "Needs modernising" },
  { value: "needs-major-work", label: "Needs major work" },
  { value: "uninhabitable", label: "Uninhabitable" },
];

const ISSUE_LABELS: Record<PropertyIssue, string> = {
  structural: "Structural movement",
  damp: "Damp",
  subsidence: "Subsidence",
  "japanese-knotweed": "Japanese knotweed",
  cladding: "Cladding",
  "short-lease": "Short lease",
  "no-building-regs": "Missing building regs",
  "title-defect": "Title defect",
  "restrictive-covenant": "Restrictive covenant",
  "flood-risk": "Flood risk",
  "non-standard-construction": "Non-standard construction",
  "unregistered-title": "Unregistered title",
};

const AGE_BANDS: readonly { value: string; label: string }[] = [
  { value: "under-65", label: "Under 65" },
  { value: "65-79", label: "65–79" },
  { value: "80-plus", label: "80 or over" },
  { value: "undisclosed", label: "Prefer not to say" },
];

const SCREENING: readonly { name: keyof SellerScreening; label: string }[] = [
  { name: "hasIndependentLegalAdvice", label: "Are you taking independent legal advice?" },
  { name: "hasReceivedIndependentValuation", label: "Have you had an independent valuation?" },
  { name: "isSoleDecisionMaker", label: "Are you the only person who decides on the sale?" },
  { name: "reportsFinancialDistress", label: "Are you under financial pressure to sell?" },
  { name: "reportsHealthOrCapacityConcern", label: "Is there a health or capacity concern?" },
  { name: "isUnderTimePressureFromThirdParty", label: "Is anyone else pressing you to sell?" },
];

const field = "mt-1 w-full rounded-md border hairline bg-surface-2 px-3 py-2 text-sm text-ink-100 focus:border-lode-500/60 focus:outline-none";

function triValue(v: boolean | undefined): "yes" | "no" | "" {
  return v === true ? "yes" : v === false ? "no" : "";
}

export function CorrectionForm({
  id,
  property,
  seller,
}: {
  id: string;
  property: PropertyFacts;
  seller: SellerProfile;
}) {
  const screening: SellerScreening = seller.screening ?? {};
  const pounds = Math.round(property.openMarketValue / 100);

  return (
    <details className="mt-12 rounded-2xl border hairline bg-surface-1">
      <summary className="cursor-pointer px-5 py-4 text-sm text-ink-200">
        Something not right? Update your details →
      </summary>
      <form action={correctEnquiry} className="space-y-5 border-t hairline px-5 py-5">
        <input type="hidden" name="id" value={id} />
        <p className="text-[13px] leading-relaxed text-ink-400">
          Correct anything below and the figures and options above are worked out again. Your link
          stays the same.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-[13px] text-ink-300">
            Your situation
            <select name="situation" defaultValue={seller.situation} className={field}>
              {allSituations().map((s) => (
                <option key={s} value={s}>{situationLabel(s)}</option>
              ))}
            </select>
          </label>
          <label className="block text-[13px] text-ink-300">
            Estimated value (£)
            <input type="number" name="sellerValuation" min={1} defaultValue={pounds} className={field} />
          </label>
          <label className="block text-[13px] text-ink-300">
            Postcode
            <input type="text" name="postcodeArea" defaultValue={property.postcodeArea} maxLength={8} className={field} />
          </label>
          <label className="block text-[13px] text-ink-300">
            Town
            <input type="text" name="locality" defaultValue={property.locality} maxLength={80} className={field} />
          </label>
          <label className="block text-[13px] text-ink-300">
            Nation
            <select name="jurisdiction" defaultValue={property.jurisdiction} className={field}>
              {(Object.keys(JURISDICTION_LABELS) as JurisdictionCode[])
                .filter((j) => j !== "US-GEN")
                .map((j) => (
                  <option key={j} value={j}>{JURISDICTION_LABELS[j]}</option>
                ))}
            </select>
          </label>
          <label className="block text-[13px] text-ink-300">
            Property type
            <select name="propertyType" defaultValue={property.propertyType} className={field}>
              {(Object.keys(TYPE_LABELS) as PropertyType[]).map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
          </label>
          <label className="block text-[13px] text-ink-300">
            Tenure
            <select name="tenure" defaultValue={property.tenure} className={field}>
              {(Object.keys(TENURE_LABELS) as Tenure[]).map((t) => (
                <option key={t} value={t}>{TENURE_LABELS[t]}</option>
              ))}
            </select>
          </label>
          <label className="block text-[13px] text-ink-300">
            Bedrooms
            <input type="number" name="bedrooms" min={0} max={20} defaultValue={property.bedrooms} className={field} />
          </label>
          <label className="block text-[13px] text-ink-300">
            Condition
            <select name="condition" defaultValue="needs-modernising" className={field}>
              {CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </label>
          {property.tenure === "leasehold" && (
            <label className="block text-[13px] text-ink-300">
              Years left on the lease
              <input
                type="number"
                name="leaseYearsRemaining"
                min={0}
                defaultValue={property.leaseYearsRemaining ?? ""}
                className={field}
              />
            </label>
          )}
        </div>

        <fieldset>
          <legend className="text-[13px] text-ink-300">What matters most to you</legend>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {(Object.keys(PRIORITY_LABELS) as SellerPriority[]).map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm text-ink-200">
                <input type="checkbox" name="priorities" value={p} defaultChecked={seller.priorities.includes(p)} className="h-4 w-4 accent-lode-400" />
                {PRIORITY_LABELS[p]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-[13px] text-ink-300">Known issues (tick any that apply)</legend>
          <div className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-2">
            {(Object.keys(ISSUE_LABELS) as PropertyIssue[]).map((i) => (
              <label key={i} className="flex items-center gap-2 text-sm text-ink-200">
                <input type="checkbox" name="issues" value={i} defaultChecked={property.knownIssues.includes(i)} className="h-4 w-4 accent-lode-400" />
                {ISSUE_LABELS[i]}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block text-[13px] text-ink-300">
          Anything else we should know
          <textarea name="narrative" rows={3} defaultValue={seller.narrative ?? ""} maxLength={2000} className={field} />
        </label>

        <fieldset className="space-y-3 border-t hairline pt-4">
          <legend className="text-[13px] text-ink-300">
            A few questions so we look after you properly
          </legend>
          {SCREENING.map((q) => {
            const current = triValue(screening[q.name] as boolean | undefined);
            return (
              <div key={q.name} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-ink-300">{q.label}</span>
                <span className="flex gap-3">
                  {[
                    { v: "yes", l: "Yes" },
                    { v: "no", l: "No" },
                    { v: "", l: "Prefer not to say" },
                  ].map((o) => (
                    <label key={o.v} className="flex items-center gap-1.5 text-[13px] text-ink-200">
                      <input type="radio" name={q.name} value={o.v} defaultChecked={current === o.v} className="accent-lode-400" />
                      {o.l}
                    </label>
                  ))}
                </span>
              </div>
            );
          })}
          <label className="block text-[13px] text-ink-300">
            Age band
            <select name="ageBand" defaultValue={screening.ageBand ?? "undisclosed"} className={field}>
              {AGE_BANDS.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </label>
        </fieldset>

        <button
          type="submit"
          className="inline-flex h-9.5 items-center justify-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300"
        >
          Save my corrections
        </button>
      </form>
    </details>
  );
}

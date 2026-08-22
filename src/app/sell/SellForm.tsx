"use client";

import { useEffect, useState } from "react";
import { submitEnquiry } from "./actions";
import { track } from "@/app/components/Analytics";

/**
 * Seller intake form.
 *
 * The order of the questions is the product. A portal opens with "how much is
 * your property worth?"; this opens with "what's stopping you moving forward?",
 * because the situation determines which routes exist and price is a
 * consequence rather than a starting point.
 *
 * The screening step is not buried or optional-looking. It feeds the Seller
 * Protection Engine, and a seller who skips it gets more caution, not less —
 * so there is no incentive to rush it, and the page says so.
 */

interface Option {
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
}

const SITUATIONS: readonly Option[] = [
  { value: "probate", label: "Probate", hint: "Dealing with an estate" },
  { value: "inherited", label: "Inherited a property", hint: "Grant already issued" },
  { value: "needs-major-works", label: "It needs a lot of work", hint: "And I don't want to do it" },
  { value: "vacant-property", label: "It's sitting empty", hint: "Costing me money each month" },
  { value: "failed-listing", label: "It didn't sell", hint: "Been on the market a while" },
  { value: "chain-collapse", label: "My chain collapsed", hint: "I need to move fast" },
  { value: "landlord-exit", label: "I'm getting out of letting", hint: "Selling up as a landlord" },
  { value: "problem-tenant", label: "I have a tenant problem", hint: "Difficult or non-paying" },
  { value: "divorce", label: "Divorce or separation", hint: "We need to divide things" },
  { value: "relocation", label: "I'm relocating", hint: "Moving for work or family" },
  { value: "mortgage-arrears", label: "I'm behind on the mortgage", hint: "Payments are a problem" },
  { value: "repossession-threat", label: "Repossession has started", hint: "The lender has taken action" },
  { value: "urgent-cash-need", label: "I need money urgently", hint: "For something other than the property" },
  { value: "auction-alternative", label: "I'm considering auction", hint: "Looking at alternatives" },
  { value: "portfolio-disposal", label: "Selling a portfolio", hint: "More than one property" },
  { value: "downsizing", label: "Downsizing", hint: "Moving somewhere smaller" },
  { value: "development-exit", label: "A development stalled", hint: "Part-built or consented" },
];

const PRIORITIES: readonly Option[] = [
  { value: "speed", label: "Speed", hint: "I need this done quickly" },
  { value: "certainty", label: "Certainty", hint: "I need it to actually complete" },
  { value: "price", label: "Price", hint: "The amount matters most" },
  { value: "convenience", label: "Convenience", hint: "No viewings, no works, no hassle" },
  { value: "flexibility", label: "Flexibility", hint: "I can be flexible on timing or payment" },
];

const CONDITIONS: readonly Option[] = [
  { value: "ready", label: "Ready to move into", hint: "Nothing needs doing" },
  { value: "tired", label: "Tired", hint: "Decoration and small repairs" },
  { value: "needs-modernising", label: "Needs modernising", hint: "Kitchen, bathroom, decoration" },
  { value: "needs-major-work", label: "Needs major work", hint: "Rewire, replumb, roof or structural" },
  { value: "uninhabitable", label: "Not liveable as it stands", hint: "Full refurbishment needed" },
];

const ISSUES: readonly Option[] = [
  { value: "damp", label: "Damp" },
  { value: "structural", label: "Structural movement" },
  { value: "subsidence", label: "Subsidence" },
  { value: "japanese-knotweed", label: "Japanese knotweed" },
  { value: "cladding", label: "Cladding" },
  { value: "no-building-regs", label: "Work done without building regs" },
  { value: "title-defect", label: "A problem with the title" },
  { value: "unregistered-title", label: "Unregistered title" },
  { value: "restrictive-covenant", label: "Restrictive covenant" },
  { value: "flood-risk", label: "Flood risk" },
  { value: "non-standard-construction", label: "Non-standard construction" },
];

const STEPS = ["Situation", "Priorities", "Property", "Value", "About you"] as const;

export function SellForm() {
  const [step, setStep] = useState(0);
  const [situation, setSituation] = useState("");
  const [priorities, setPriorities] = useState<string[]>([]);
  const [tenure, setTenure] = useState("freehold");
  const [submitting, setSubmitting] = useState(false);

  const canAdvance =
    (step === 0 && situation !== "") || (step === 1 && priorities.length > 0) || step >= 2;

  // The top of the funnel. Once per mount, not once per render.
  useEffect(() => {
    track("sell_intake_started");
  }, []);

  /**
   * Advance, and record it.
   *
   * The step number only — never the situation the seller chose. "Probate" or
   * "divorce" against a browser Meta can join to a real identity is information
   * about someone's family life, and no funnel report is worth that.
   */
  function advance(next: number): void {
    track("sell_intake_step_completed", { step: step + 1 });
    setStep(next);
  }

  return (
    <form
      action={submitEnquiry}
      onSubmit={() => {
        setSubmitting(true);
        // The conversion. No answers travel with it — only that one happened.
        track("sell_intake_submitted");
      }}
      className="mx-auto max-w-3xl px-6 pb-32"
    >
      <Progress step={step} />

      {/* Step 1 — the situation, asked before anything about money. */}
      <Panel active={step === 0}>
        <Legend
          title="What's stopping you moving forward?"
          lede="Not what the property is worth — that comes later. Tell us the situation, because it determines which options actually exist for you."
        />
        <div className="mt-8 grid gap-2.5 sm:grid-cols-2">
          {SITUATIONS.map((s) => (
            <label
              key={s.value}
              className={`cursor-pointer rounded-xl border px-4 py-3.5 transition ${
                situation === s.value
                  ? "border-lode-500/60 bg-lode-400/10"
                  : "hairline bg-ink-900/40 hover:border-ink-400"
              }`}
            >
              <input
                type="radio"
                name="situation"
                value={s.value}
                checked={situation === s.value}
                onChange={(e) => setSituation(e.target.value)}
                className="sr-only"
                required
              />
              <span className="block text-sm text-ink-100">{s.label}</span>
              {s.hint !== undefined && (
                <span className="mt-0.5 block text-xs text-ink-400">{s.hint}</span>
              )}
            </label>
          ))}
        </div>

        <Field label="Tell us in your own words" hint="Optional, but the more we know the better the options.">
          <textarea
            name="narrative"
            rows={4}
            placeholder="I've inherited my mother's house. It needs about £30,000 of work. I don't want to renovate it and I need the money within six weeks."
            className="w-full rounded-xl border hairline bg-ink-900/60 px-4 py-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-lode-500/60 focus:outline-none"
          />
        </Field>
      </Panel>

      {/* Step 2 — priorities, which decide how routes are ranked. */}
      <Panel active={step === 1}>
        <Legend
          title="What matters most to you?"
          lede="Pick everything that applies. We rank your options against this, not by which one pays the most — a bigger number in four months is no use if you need to complete in three weeks."
        />
        <div className="mt-8 grid gap-2.5">
          {PRIORITIES.map((p) => (
            <label
              key={p.value}
              className={`cursor-pointer rounded-xl border px-4 py-3.5 transition ${
                priorities.includes(p.value)
                  ? "border-lode-500/60 bg-lode-400/10"
                  : "hairline bg-ink-900/40 hover:border-ink-400"
              }`}
            >
              <input
                type="checkbox"
                name="priorities"
                value={p.value}
                checked={priorities.includes(p.value)}
                onChange={(e) =>
                  setPriorities((prev) =>
                    e.target.checked ? [...prev, p.value] : prev.filter((x) => x !== p.value),
                  )
                }
                className="sr-only"
              />
              <span className="block text-sm text-ink-100">{p.label}</span>
              <span className="mt-0.5 block text-xs text-ink-400">{p.hint}</span>
            </label>
          ))}
        </div>

        <Field label="When do you need this done by?" hint="In days. Leave blank if there's no deadline.">
          <input
            type="number"
            name="targetDays"
            min={1}
            placeholder="42"
            className="w-40 rounded-xl border hairline bg-ink-900/60 px-4 py-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-lode-500/60 focus:outline-none"
          />
        </Field>
      </Panel>

      {/* Step 3 — the property. */}
      <Panel active={step === 2}>
        <Legend title="The property" lede="Enough to work out what it is and who could buy it." />

        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          <Field label="Postcode area" hint="Just the first part, e.g. B23">
            <Input name="postcodeArea" placeholder="B23" required maxLength={8} />
          </Field>
          <Field label="Town or area">
            <Input name="locality" placeholder="Erdington" required />
          </Field>
          <Field label="Nation">
            <Select name="jurisdiction" defaultValue="GB-ENG">
              <option value="GB-ENG">England</option>
              <option value="GB-SCT">Scotland</option>
              <option value="GB-WLS">Wales</option>
              <option value="GB-NIR">Northern Ireland</option>
            </Select>
          </Field>
          <Field label="Property type">
            <Select name="propertyType" defaultValue="house">
              <option value="house">House</option>
              <option value="flat">Flat</option>
              <option value="bungalow">Bungalow</option>
              <option value="hmo">HMO</option>
              <option value="commercial">Commercial</option>
              <option value="mixed-use">Mixed use</option>
              <option value="land">Land</option>
            </Select>
          </Field>
          <Field label="Bedrooms">
            <Input name="bedrooms" type="number" min={0} defaultValue={3} />
          </Field>
          <Field label="Tenure">
            <Select name="tenure" value={tenure} onChange={(e) => setTenure(e.target.value)}>
              <option value="freehold">Freehold</option>
              <option value="leasehold">Leasehold</option>
              <option value="share-of-freehold">Share of freehold</option>
              <option value="unknown">I'm not sure</option>
            </Select>
          </Field>
          {tenure === "leasehold" && (
            <Field label="Years left on the lease" hint="Below 80 years materially affects value.">
              <Input name="leaseYearsRemaining" type="number" min={1} placeholder="74" />
            </Field>
          )}
        </div>

        <Field label="What condition is it in?">
          <div className="grid gap-2.5">
            {CONDITIONS.map((c, i) => (
              <label
                key={c.value}
                className="cursor-pointer rounded-xl border hairline bg-ink-900/40 px-4 py-3 transition hover:border-ink-400 has-[:checked]:border-lode-500/60 has-[:checked]:bg-lode-400/10"
              >
                <input
                  type="radio"
                  name="condition"
                  value={c.value}
                  defaultChecked={i === 2}
                  className="sr-only"
                  required
                />
                <span className="block text-sm text-ink-100">{c.label}</span>
                <span className="mt-0.5 block text-xs text-ink-400">{c.hint}</span>
              </label>
            ))}
          </div>
        </Field>

        <Field label="Anything we should know about?" hint="Select any that apply. These affect who can buy it and how.">
          <div className="flex flex-wrap gap-2">
            {ISSUES.map((i) => (
              <label
                key={i.value}
                className="cursor-pointer rounded-full border hairline bg-ink-900/40 px-3.5 py-1.5 text-xs text-ink-300 transition hover:border-ink-400 has-[:checked]:border-lode-500/60 has-[:checked]:bg-lode-400/10 has-[:checked]:text-lode-200"
              >
                <input type="checkbox" name="issues" value={i.value} className="sr-only" />
                {i.label}
              </label>
            ))}
          </div>
        </Field>
      </Panel>

      {/* Step 4 — value, asked last and treated as a claim. */}
      <Panel active={step === 3}>
        <Legend
          title="What do you think it's worth?"
          lede="Your best guess is fine. We treat this as your estimate, not a valuation — and we'll tell you plainly on the next page which figures we've verified and which we haven't."
        />
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          <Field label="Your estimate of its value" hint="As it stands today.">
            <Input name="sellerValuation" placeholder="£212,000" required inputMode="numeric" />
          </Field>
          <Field label="Current asking price" hint="If it's on the market now.">
            <Input name="currentAsking" placeholder="£199,950" inputMode="numeric" />
          </Field>
          <Field label="The least you would accept" hint="Optional. It helps us rule options in or out honestly.">
            <Input name="priceExpectation" placeholder="£178,000" inputMode="numeric" />
          </Field>
        </div>
      </Panel>

      {/* Step 5 — screening. Feeds the protection engine. */}
      <Panel active={step === 4}>
        <Legend
          title="A few questions about your situation"
          lede="These decide what safeguards we put in place. Nothing here reduces what you're offered — and if you'd rather not answer something, leave it blank and we'll be more careful, not less."
        />

        <div className="mt-8 space-y-5">
          <YesNo
            name="isSoleDecisionMaker"
            question="Are you the only person who needs to agree to the sale?"
            hint="If the property has more than one owner, everyone must consent."
          />
          <YesNo
            name="hasIndependentLegalAdvice"
            question="Do you have your own solicitor, independent of any buyer?"
          />
          <YesNo
            name="hasReceivedIndependentValuation"
            question="Have you had an independent valuation?"
            hint="Not an agent's free appraisal — a valuation you commissioned."
          />
          <YesNo
            name="reportsFinancialDistress"
            question="Are you under significant financial pressure right now?"
          />
          <YesNo
            name="isUnderTimePressureFromThirdParty"
            question="Is anyone other than you pressing you to sell quickly?"
          />
          <YesNo
            name="reportsHealthOrCapacityConcern"
            question="Is there any health condition affecting your ability to make this decision?"
          />

          <Field label="Your age" hint="Optional. It affects the safeguards we apply, not your options.">
            <Select name="ageBand" defaultValue="undisclosed">
              <option value="undisclosed">Prefer not to say</option>
              <option value="under-65">Under 65</option>
              <option value="65-79">65 to 79</option>
              <option value="80-plus">80 or over</option>
            </Select>
          </Field>
        </div>

        <div className="mt-10 rounded-xl border hairline bg-ink-900/50 px-5 py-4">
          <p className="text-xs leading-relaxed text-ink-400">
            What happens next: we show you the routes that are genuinely available, what each one
            pays you and when, and what you give up to get it. We will also show you what a buyer
            would make on the transaction. Nothing you see is an offer, and you are free to sell on
            the open market instead.
          </p>
        </div>
      </Panel>

      <Nav
        step={step}
        total={STEPS.length}
        canAdvance={canAdvance}
        submitting={submitting}
        onBack={() => setStep((s) => Math.max(0, s - 1))}
        onNext={() => advance(Math.min(STEPS.length - 1, step + 1))}
      />
    </form>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2 py-10">
      {STEPS.map((label, i) => (
        <div key={label} className="flex flex-1 flex-col gap-2">
          <div className={`h-0.5 rounded-full ${i <= step ? "bg-lode-400" : "bg-ink-700"}`} />
          <span
            className={`text-[10px] uppercase tracking-[0.1em] ${i <= step ? "text-lode-300" : "text-ink-500"}`}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Inactive steps stay mounted but hidden, so answers survive navigation and the
 * whole form posts in one request. `hidden` also removes them from the tab
 * order and the accessibility tree, so a keyboard or screen-reader user is not
 * dropped into fields they cannot see.
 */
function Panel({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <fieldset hidden={!active} className="border-0 p-0">
      {children}
    </fieldset>
  );
}

function Legend({ title, lede }: { title: string; lede: string }) {
  return (
    <div>
      <h2 className="font-display text-3xl leading-tight text-ink-100 sm:text-4xl">{title}</h2>
      <p className="mt-4 text-base leading-relaxed text-ink-400">{lede}</p>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-8 block">
      <span className="block text-sm text-ink-200">{label}</span>
      {hint !== undefined && <span className="mt-0.5 block text-xs text-ink-500">{hint}</span>}
      <div className="mt-2.5">{children}</div>
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-xl border hairline bg-ink-900/60 px-4 py-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-lode-500/60 focus:outline-none"
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="w-full rounded-xl border hairline bg-ink-900/60 px-4 py-3 text-sm text-ink-100 focus:border-lode-500/60 focus:outline-none"
    />
  );
}

function YesNo({ name, question, hint }: { name: string; question: string; hint?: string }) {
  return (
    <div className="rounded-xl border hairline bg-ink-900/40 px-5 py-4">
      <p className="text-sm text-ink-100">{question}</p>
      {hint !== undefined && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
      <div className="mt-3 flex gap-2">
        {[
          { v: "yes", l: "Yes" },
          { v: "no", l: "No" },
          { v: "", l: "Rather not say" },
        ].map((o) => (
          <label
            key={o.v}
            className="cursor-pointer rounded-full border hairline px-4 py-1.5 text-xs text-ink-300 transition hover:border-ink-400 has-[:checked]:border-lode-500/60 has-[:checked]:bg-lode-400/10 has-[:checked]:text-lode-200"
          >
            <input
              type="radio"
              name={name}
              value={o.v}
              defaultChecked={o.v === ""}
              className="sr-only"
            />
            {o.l}
          </label>
        ))}
      </div>
    </div>
  );
}

function Nav({
  step,
  total,
  canAdvance,
  submitting,
  onBack,
  onNext,
}: {
  step: number;
  total: number;
  canAdvance: boolean;
  submitting: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const last = step === total - 1;
  return (
    <div className="mt-12 flex items-center justify-between border-t hairline pt-8">
      <button
        type="button"
        onClick={onBack}
        disabled={step === 0}
        className="text-sm text-ink-400 transition hover:text-ink-100 disabled:opacity-30"
      >
        Back
      </button>

      {/*
        Both buttons are always rendered and toggled with `hidden`, never
        swapped for one another.

        Rendering one button whose `type` flips from "button" to "submit"
        looks equivalent but is not: React reuses the same DOM node, so the
        type changes during the click, and the browser then runs the default
        action on a node that has become a submit button. The form posts from
        the step *before* the last one, skipping the screening questions
        entirely — which on this form means submitting without the answers the
        Seller Protection Engine depends on.
      */}
      <button
        type="button"
        onClick={onNext}
        hidden={last}
        disabled={!canAdvance}
        className="rounded-full bg-lode-400 px-7 py-3 text-sm font-medium text-ink-950 transition hover:bg-lode-300 disabled:opacity-30"
      >
        Continue
      </button>
      <button
        type="submit"
        hidden={!last}
        disabled={submitting}
        className="rounded-full bg-lode-400 px-7 py-3 text-sm font-medium text-ink-950 transition hover:bg-lode-300 disabled:opacity-60"
      >
        {submitting ? "Working out your options…" : "Show me my options"}
      </button>
    </div>
  );
}

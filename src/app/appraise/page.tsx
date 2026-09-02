import Link from "next/link";
import { Badge, Button, Panel, SiteHeader, Stat } from "@/app/components/chrome";
import { appraise, maxViablePrice } from "@shared/domain/economics";
import { borrowingReport } from "@shared/domain/borrowing";
import { fundingMetrics } from "@shared/domain/fundingMetrics";
import { runRedTeam } from "@shared/domain/redteam";
import { routeStrategies } from "@shared/domain/strategies";
import { getJurisdiction } from "@shared/domain/jurisdictions";
import {
  APPRAISAL_EXITS,
  APPRAISAL_JURISDICTIONS,
  APPRAISAL_STRUCTURES,
  hasSubmission,
  parseAppraisal,
  TARGET_MARGIN_BPS,
  type AppraisalFields,
} from "@shared/domain/appraisalRequest";
import { add, bps, sub, ZERO } from "@shared/money";
import { gbp, gbpSigned, percent } from "@shared/format";

export const metadata = {
  title: "Free deal appraisal — Lode",
  description:
    "Paste a deal. Get the true discount after every cost, the price you should walk away at, and the stresses that break it. No account, nothing stored.",
};

/**
 * The appraisal anybody can run.
 *
 * No account, no email, nothing written anywhere. The figures arrive in the
 * query string, the engine runs on the server, and the result is a URL that can
 * be sent to a business partner — which is also why there is no client
 * JavaScript here at all: a plain GET form works with scripts blocked, and the
 * back button does what a reader expects.
 *
 * It shows the buyer's arithmetic and refuses to show a Deal Score. Scoring
 * runs Seller Protection and the motivation diagnostics, both of which need
 * answers about a person nobody here has spoken to, and a score computed from a
 * blank seller would be a number with nothing behind it.
 */
export default async function AppraisePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const one = (key: string): string | undefined => {
    const value = raw[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const fields: AppraisalFields = {
    purchasePrice: one("purchasePrice"),
    marketValue: one("marketValue"),
    refurbishment: one("refurbishment"),
    postWorksValue: one("postWorksValue"),
    monthlyRent: one("monthlyRent"),
    jurisdiction: one("jurisdiction"),
    structure: one("structure"),
    exit: one("exit"),
    holdMonths: one("holdMonths"),
    ltv: one("ltv"),
    rate: one("rate"),
    company: one("company"),
    ownsOther: one("ownsOther"),
    nonResident: one("nonResident"),
  };

  const submitted = hasSubmission(fields);
  const parsed = submitted ? parseAppraisal(fields) : undefined;

  return (
    <main className="min-h-screen pb-20">
      <SiteHeader
        width="max-w-5xl"
        trailing={
          <nav className="flex items-center gap-5 text-[13px] text-ink-400">
            <Link href="/sell" className="transition-colors hover:text-ink-100">Selling</Link>
            <Link href="/blog" className="transition-colors hover:text-ink-100">Writing</Link>
            <Button href="/operator" size="sm">Sign in</Button>
          </nav>
        }
      />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <p className="eyebrow">Free appraisal</p>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[34px] sm:leading-[1.12]">
          What is this deal actually worth, after every cost?
        </h1>
        <p className="mt-4 max-w-[38rem] text-[15px] leading-[1.6] text-ink-300">
          Twenty per cent below market value is not a twenty per cent discount. Enter a deal and the
          same engine that runs the pipeline will tell you the true discount, the price above which
          it stops working, and which single thing breaks it first.
        </p>
        <p className="mt-3 max-w-[38rem] text-[13px] leading-[1.6] text-ink-500">
          No account, no email address, and nothing is stored — the figures live in the address bar,
          which is also how you send a result to somebody else.
        </p>

        <Form fields={fields} />

        {parsed !== undefined && !parsed.ok && (
          <div className="mt-8 rounded-lg border-l-2 border-amber-500/80 bg-surface-1 px-5 py-4">
            <p className="text-[13px] font-medium text-amber-200">
              Not enough to appraise this yet.
            </p>
            <ul className="mt-2 space-y-1">
              {parsed.problems.map((p) => (
                <li key={p.field} className="text-[13px] leading-[1.6] text-ink-300">
                  {p.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {parsed !== undefined && parsed.ok && (
          <Result inputs={parsed.inputs} assumptions={parsed.assumptions} />
        )}
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------- form */

/**
 * A plain GET form.
 *
 * No `useActionState`, no fetch, no client component. The browser submits it,
 * the server renders the answer, and the result has a URL. Everything a
 * visitor might want to do with a result — bookmark it, send it, change one
 * figure and compare — works because of that and would not otherwise.
 */
function Form({ fields }: { fields: AppraisalFields }) {
  return (
    <form method="get" action="/appraise" className="mt-8">
      <fieldset className="rounded-xl border hairline bg-surface-1">
        <legend className="sr-only">The deal</legend>

        <div className="grid gap-x-5 gap-y-4 px-5 py-5 sm:grid-cols-3">
          <Field
            label="Price you would pay"
            name="purchasePrice"
            value={fields.purchasePrice}
            placeholder="172,000"
            required
          />
          <Field
            label="Worth today, as it stands"
            name="marketValue"
            value={fields.marketValue}
            placeholder="212,000"
            required
          />
          <Field
            label="Refurbishment"
            name="refurbishment"
            value={fields.refurbishment}
            placeholder="34,000"
          />
          <Field
            label="Worth after the works"
            name="postWorksValue"
            value={fields.postWorksValue}
            placeholder="285,000"
            hint="Leave blank and the works are assumed to add only what they cost."
          />
          <Field
            label="Monthly rent"
            name="monthlyRent"
            value={fields.monthlyRent}
            placeholder="1,250"
            hint="Only needed for a refinance exit."
          />
          <Select label="Where" name="jurisdiction" value={fields.jurisdiction}>
            {APPRAISAL_JURISDICTIONS.map((j) => (
              <option key={j.code} value={j.code}>{j.label}</option>
            ))}
          </Select>
        </div>

        <details className="border-t hairline px-5 py-4">
          <summary className="cursor-pointer text-[13px] text-ink-400 transition-colors hover:text-ink-100">
            Structure, finance and buyer — or leave them and see the assumptions
          </summary>

          <div className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-3">
            <Select label="Structure" name="structure" value={fields.structure}>
              {APPRAISAL_STRUCTURES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <Select label="Exit" name="exit" value={fields.exit}>
              {APPRAISAL_EXITS.map((e) => (
                <option key={e.value} value={e.value}>{e.label}</option>
              ))}
            </Select>
            <Field label="Hold (months)" name="holdMonths" value={fields.holdMonths} placeholder="9" />
            <Field label="Loan to value (%)" name="ltv" value={fields.ltv} placeholder="70" />
            <Field label="Rate (% a year)" name="rate" value={fields.rate} placeholder="11" />
            <div className="space-y-2 self-end">
              <Check label="Buying through a company" name="company" checked={fields.company === "on"} />
              <Check
                label="Already own another dwelling"
                name="ownsOther"
                checked={fields.ownsOther !== "off"}
              />
              <Check
                label="Non-resident buyer"
                name="nonResident"
                checked={fields.nonResident === "on"}
              />
            </div>
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-3 border-t hairline px-5 py-4">
          <button
            type="submit"
            className="inline-flex h-9.5 items-center justify-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300"
          >
            Appraise it
          </button>
          <span className="text-[12px] text-ink-500">
            Nothing is sent anywhere but back to you.
          </span>
        </div>
      </fieldset>
    </form>
  );
}

function Field({
  label,
  name,
  value,
  placeholder,
  hint,
  required,
}: {
  label: string;
  name: string;
  value?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-[13px] text-ink-300">
        {label}
        {required === true && <span className="ml-1 text-ink-600">required</span>}
      </label>
      <input
        id={name}
        name={name}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={value ?? ""}
        placeholder={placeholder}
        className="mt-1.5 w-full px-3 py-2"
      />
      {hint !== undefined && <p className="mt-1 text-[11px] leading-snug text-ink-500">{hint}</p>}
    </div>
  );
}

function Select({
  label,
  name,
  value,
  children,
}: {
  label: string;
  name: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-[13px] text-ink-300">{label}</label>
      <select id={name} name={name} defaultValue={value} className="mt-1.5 w-full px-3 py-2">
        {children}
      </select>
    </div>
  );
}

function Check({ label, name, checked }: { label: string; name: string; checked: boolean }) {
  return (
    <label className="flex items-start gap-2.5 text-[13px] leading-snug text-ink-300">
      <input type="checkbox" name={name} defaultChecked={checked} className="mt-0.5 shrink-0" />
      {label}
    </label>
  );
}

/* ----------------------------------------------------------------- result */

function Result({
  inputs,
  assumptions,
}: {
  inputs: Parameters<typeof appraise>[0];
  assumptions: readonly string[];
}) {
  const a = appraise(inputs);
  const redTeam = runRedTeam(inputs);
  const borrowing = borrowingReport(a);
  const metrics = fundingMetrics(a);
  const router = routeStrategies(inputs);
  const ceiling = maxViablePrice(inputs, TARGET_MARGIN_BPS);
  const pack = getJurisdiction(inputs.property.jurisdiction);

  const headline = a.discountToOmvBps;
  const truth = a.trueDiscountBps;
  const overpaying = ceiling > ZERO && inputs.purchasePrice > ceiling;
  const singles = redTeam.results.filter(
    (r) => r.stress.tier === "single" && (r.wipesOutProfit || r.losesCapital),
  );

  return (
    <section className="mt-10">
      {/* The one figure the page exists to show. */}
      <div className="rounded-xl border hairline bg-surface-1 px-5 py-6 sm:px-7 sm:py-7">
        <p className="eyebrow">The number that matters</p>
        <div className="mt-4 grid gap-6 sm:grid-cols-[1fr_1fr_1.4fr] sm:items-center">
          <Stat label="Headline discount" value={percent(headline)} size="lg" tone="text-ink-300" />
          <Stat
            label="True discount"
            value={percent(truth)}
            size="lg"
            warn={truth < 0}
            note="after every cost, fee and tax"
          />
          {/*
            Stated from the figures rather than as a slogan. The true discount
            compares everything spent to reach the finished asset against what
            that asset is worth today, unimproved — so a negative one has a
            precise meaning worth spelling out, and it is not "you paid over
            the odds".
          */}
          <p className="text-[14px] leading-[1.6] text-ink-300">
            {truth < 0 ? (
              <>
                There is no discount left. You would be into this property for{" "}
                <span className="tnum text-ink-100">{gbp(a.effectiveBasis)}</span> against a market
                value today of <span className="tnum text-ink-100">{gbp(inputs.property.openMarketValue)}</span>
                . The headline saving is spent before the works are finished.
              </>
            ) : truth < headline ? (
              <>
                The headline says {percent(headline)}. After the transfer tax, the finance, the
                works, the contingency and the holding costs,{" "}
                <span className="text-ink-100">{percent(truth)}</span> of it survives. The
                difference is what a sourcing flyer leaves out.
              </>
            ) : (
              <>
                Every pound of the headline discount survives the cost stack, which is unusual
                enough to be worth re-checking the refurbishment figure against a builder&rsquo;s
                quote.
              </>
            )}
          </p>
        </div>
      </div>

      {/* What to do about it. */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel eyebrow="Walk away above" title={ceiling > ZERO ? gbp(ceiling) : "No price works"}>
          {ceiling > ZERO ? (
            <p className="text-[13px] leading-[1.65] text-ink-300">
              The most that can be paid and still clear a {percent(TARGET_MARGIN_BPS, 0)} margin on
              the end value.{" "}
              {overpaying ? (
                <span className="text-red-300">
                  You are {gbp(sub(inputs.purchasePrice, ceiling))} above it at {gbp(inputs.purchasePrice)}.
                </span>
              ) : (
                <span className="text-emerald-300">
                  You have {gbp(sub(ceiling, inputs.purchasePrice))} of room at {gbp(inputs.purchasePrice)}.
                </span>
              )}
            </p>
          ) : (
            <p className="text-[13px] leading-[1.65] text-ink-300">
              No purchase price produces a {percent(TARGET_MARGIN_BPS, 0)} margin on these figures.
              The problem is not the price — it is the end value, the works, or the cost of the money.
            </p>
          )}
        </Panel>

        <Panel eyebrow="Result" title={`${gbpSigned(a.profit)} after tax`}>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Margin on end value" value={percent(a.marginOnGdvBps)} size="sm" warn={a.profit < ZERO} />
            <Stat label="Return on cash" value={percent(a.roiOnCashBps, 0)} size="sm" />
            <Stat label="Cash in" value={gbp(a.funding.equityRequired)} size="sm" />
            <Stat label="Annualised" value={percent(a.annualisedRoiBps, 0)} size="sm" />
          </div>
        </Panel>
      </div>

      {/* The cost stack, in full, because the whole argument is that it is
          bigger than people carry in their heads. */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel eyebrow="Every cost" title="Where the money goes">
          <dl>
            <Line k="Purchase price" v={gbp(a.costs.purchasePrice)} />
            <Line k={a.costs.transferTaxLabel} v={gbp(a.costs.transferTax)} />
            <Line k="Refurbishment" v={gbp(a.costs.refurbishment)} />
            <Line k="Contingency" v={gbp(a.costs.contingency)} />
            <Line
              k="Finance"
              v={gbp(
                add(
                  a.costs.financeArrangement,
                  a.costs.financeBroker,
                  a.costs.financeInterest,
                  a.costs.financeExit,
                  a.costs.lenderCosts,
                ),
              )}
            />
            <Line k="Legal and survey" v={gbp(add(a.costs.buyerLegal, a.costs.survey))} />
            <Line k="Holding" v={gbp(a.costs.holdingCosts)} />
            <Line k="Selling" v={gbp(a.costs.sellingCosts)} />
            <Line k="Total deployed" v={gbp(a.costs.total)} strong />
            <Line k="End value" v={gbp(a.exit.grossDevelopmentValue)} />
            <Line k={a.profitTaxLabel} v={gbp(a.profitTax)} />
            <Line k="Profit after tax" v={gbpSigned(a.profit)} strong tone={a.profit < ZERO ? "text-red-300" : "text-lode-300"} />
          </dl>
        </Panel>

        <div className="space-y-5">
          <Panel eyebrow="Red Team" title={`Resilience ${redTeam.resilience}/100`}>
            <p className="text-[13px] leading-[1.65] text-ink-300">{redTeam.summary}</p>
            {singles.length > 0 && (
              <ul className="mt-3.5 space-y-2 border-t hairline pt-3.5">
                {singles.map((r) => (
                  <li key={r.stress.key} className="text-[13px] leading-[1.6] text-ink-300">
                    <span className="text-red-300">{r.stress.label}</span> —{" "}
                    {r.losesCapital ? "loses capital" : "wipes out the profit"}, at{" "}
                    <span className="tnum">{gbpSigned(r.profit)}</span>.
                  </li>
                ))}
              </ul>
            )}
            {singles.length === 0 && (
              <p className="mt-3 text-[13px] leading-[1.6] text-emerald-300">
                No single factor on its own wipes out the profit.
              </p>
            )}
          </Panel>

          {inputs.structure !== "cash-purchase" && (
            <Panel eyebrow="The money" title={`${gbp(borrowing.cost.total)} to borrow it`}>
              <p className="text-[13px] leading-[1.65] text-ink-300">
                {percent(bps(borrowing.cost.costOfFacilityBps))} of the facility over{" "}
                {borrowing.cost.termMonths} months. {gbp(borrowing.advance.deducted)} is deducted at
                drawdown, so {gbp(borrowing.advance.received)} actually arrives.
              </p>
              {borrowing.warning !== undefined && (
                <p className="mt-2.5 text-[13px] leading-[1.6] text-amber-300">{borrowing.warning}</p>
              )}
            </Panel>
          )}
        </div>
      </div>

      {/* Ratios and the router. */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel eyebrow="What a funder measures" title="Ratios">
          <div className="grid grid-cols-2 gap-4">
            {metrics.metrics.slice(0, 4).map((m) => (
              <Stat
                key={m.key}
                label={m.label}
                value={
                  m.display === "percent" && m.bps !== undefined
                    ? percent(m.bps)
                    : m.display === "times" && m.bps !== undefined
                      ? `${(m.bps / 10_000).toFixed(2)}×`
                      : gbp(m.amount ?? ZERO)
                }
                size="sm"
              />
            ))}
          </div>
          <p className="mt-4 border-t hairline pt-3 text-[12px] leading-relaxed text-ink-500">
            {metrics.summary}
          </p>
        </Panel>

        <Panel eyebrow="Strategy Router" title="Is this the right shape?">
          {router.best !== undefined ? (
            <p className="text-[13px] leading-[1.65] text-ink-300">
              Of fourteen structures tested, <span className="text-ink-100">{router.best.candidate.label}</span>{" "}
              ranks first. {router.best.reason}
            </p>
          ) : (
            <p className="text-[13px] leading-[1.65] text-ink-300">
              No structure tested clears the bar on these figures. That is a finding, not an error.
            </p>
          )}
        </Panel>
      </div>

      {/* Assumptions and the honest limits. */}
      <div className="mt-5 rounded-xl border hairline bg-surface-1 px-5 py-4">
        <p className="eyebrow">What this assumed, and what it will not tell you</p>

        {assumptions.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {assumptions.map((line) => (
              <li key={line} className="flex gap-2.5 text-[13px] leading-[1.6] text-ink-400">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-600" />
                {line}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 space-y-2.5 border-t hairline pt-3.5">
          <p className="text-[13px] leading-[1.65] text-ink-400">
            <span className="text-ink-200">There is no Deal Score here.</span> Scoring runs Seller
            Protection and the motivation diagnostics, and both need answers about a person nobody
            here has spoken to. A score computed from a blank seller is a number with nothing behind
            it, so this shows the buyer&rsquo;s arithmetic and stops.
          </p>
          <p className="text-[13px] leading-[1.65] text-ink-400">
            <span className="text-ink-200">{a.profitTaxLabel} is an estimate for screening only</span>{" "}
            and must be confirmed by a qualified adviser before exchange. Rate tables for {pack.name}{" "}
            are a dated snapshot, as at {pack.asOf}.
          </p>
          <p className="text-[13px] leading-[1.65] text-ink-400">
            Nothing on this page is advice, a valuation, or an offer, and nothing you entered was
            stored.
          </p>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3 border-t hairline pt-7">
        <Button href="/operator" variant="primary">See the whole pipeline</Button>
        <Button href="/sell">I am the one selling</Button>
        <span className="text-[12px] text-ink-500">
          Change a figure above and submit again — the URL carries the result.
        </span>
      </div>
    </section>
  );
}

function Line({
  k,
  v,
  strong,
  tone,
}: {
  k: string;
  v: string;
  strong?: boolean;
  tone?: string;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-6 py-2 ${
        strong === true ? "border-t hairline-strong mt-1 pt-2.5" : "border-b hairline"
      }`}
    >
      <dt className={`text-[13px] ${strong === true ? "text-ink-200" : "text-ink-400"}`}>{k}</dt>
      <dd className={`tnum text-[13px] ${tone ?? (strong === true ? "text-ink-100" : "text-ink-200")}`}>
        {v}
      </dd>
    </div>
  );
}

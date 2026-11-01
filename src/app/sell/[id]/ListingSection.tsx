import { materialInformation } from "@shared/domain/materialInformation";
import type { MaterialRecord } from "@shared/domain/materialInformation";
import type { ResaleConsent } from "@shared/domain/reseller";
import type { PropertyFacts } from "@shared/domain/types";
import { recordSellerMaterial, setResaleConsent } from "../actions";

/**
 * The seller's self-serve route to a live listing.
 *
 * A buyer must be told the material facts before a property can be marketed at
 * all (`materialInformation.ts`, §66), and those facts are the owner's own
 * knowledge — tenure, council tax, the lease. So the seller provides them here,
 * one item at a time, through their capability link. No account, no operator.
 *
 * It is deliberately only half of "ready to list". The other half — verifying
 * who the seller is and that they may sell (§67) — is a check Lode performs, not
 * one the seller can tick, so this section says plainly that a human check still
 * follows and never implies the property is live the moment the form is full.
 */
export function ListingSection({
  id,
  property,
  material,
  resaleConsent,
  notice,
}: {
  id: string;
  property: PropertyFacts;
  material: MaterialRecord | undefined;
  resaleConsent: ResaleConsent | undefined;
  notice?: "updated" | "needs-detail" | "resale-on" | "resale-off";
}) {
  const report = materialInformation(property, material ?? {});
  const resaleAllowed = resaleConsent !== undefined;

  return (
    <section id="listing" className="mt-14 scroll-mt-6">
      <p className="eyebrow">List your property</p>
      <h2 className="mt-2 font-display text-[21px] leading-tight text-ink-100">
        What buyers must be told
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-400">
        A property can only be put in front of buyers once the facts below are recorded — it is the
        law, and it is the owner who knows them. Answer what you can. &ldquo;I don&rsquo;t
        know&rdquo; is a fine answer and is published as exactly that, never guessed.
      </p>

      {notice === "updated" && (
        <p className="mt-4 rounded-lg border-l-2 border-emerald-500 bg-surface-1 px-5 py-3 text-sm text-ink-200">
          Saved. Your listing readiness is updated below.
        </p>
      )}
      {notice === "needs-detail" && (
        <p className="mt-4 rounded-lg border-l-2 border-amber-500 bg-surface-1 px-5 py-3 text-sm text-ink-200">
          Add the detail for what you were recording, then save it again.
        </p>
      )}
      {notice === "resale-on" && (
        <p className="mt-4 rounded-lg border-l-2 border-emerald-500 bg-surface-1 px-5 py-3 text-sm text-ink-200">
          Vetted partners may now help market your property. You can withdraw that at any time below.
        </p>
      )}
      {notice === "resale-off" && (
        <p className="mt-4 rounded-lg border-l-2 border-ink-500 bg-surface-1 px-5 py-3 text-sm text-ink-200">
          Partners can no longer market your property. Only Lode will.
        </p>
      )}

      {/* Readiness — honest about the half that is not the seller's to clear. */}
      <div className="mt-6 rounded-2xl border hairline bg-surface-1 px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] ${
              report.mayMarket
                ? "border-emerald-600/45 bg-emerald-500/10 text-emerald-300"
                : "border-amber-600/45 bg-amber-500/10 text-amber-300"
            }`}
          >
            {report.mayMarket ? "Facts complete" : "Facts needed"}
          </span>
          <span className="text-sm text-ink-300">{report.summary}</span>
        </div>
        <p className="mt-3 border-l-2 border-ink-700 pl-3 text-xs leading-relaxed text-ink-400">
          Even once these are complete, one step remains that is not yours to do: we verify who you
          are and that the property is yours to sell, as the law requires of us. We will be in touch
          to do that. Your property goes live to buyers once both are done.
        </p>
      </div>

      <div className="mt-6 space-y-3">
        {report.items.map(({ item, knowledge, answered, shown }) => (
          <form
            key={item.key}
            action={recordSellerMaterial}
            className="rounded-2xl border hairline bg-surface-1 px-5 py-4"
          >
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="key" value={item.key} />
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-sm text-ink-100">
                {item.label}
                {item.part === "A" && (
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-lode-300">
                    required
                  </span>
                )}
              </h3>
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-500">
                {answered ? "Answered" : "Not recorded"}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">{item.why}</p>
            {answered && (
              <p className="mt-2 border-l-2 border-emerald-500/70 pl-3 text-xs leading-relaxed text-ink-300">
                {shown}
              </p>
            )}

            <div className="mt-3 grid gap-2.5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
              <select
                name="state"
                defaultValue={knowledge?.state ?? "stated"}
                className="rounded-xl border hairline bg-surface-2 px-3 py-2 text-sm text-ink-100 focus:border-lode-500/60 focus:outline-none"
              >
                <option value="stated">I know this</option>
                <option value="not-applicable">Doesn&rsquo;t apply</option>
                <option value="not-known">I don&rsquo;t know</option>
              </select>
              <input
                name="text"
                placeholder="The answer, or why it doesn't apply"
                maxLength={600}
                className="w-full rounded-xl border hairline bg-surface-2 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-lode-500/60 focus:outline-none"
              />
              <button
                type="submit"
                className="inline-flex h-9 items-center justify-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300 active:bg-lode-500"
              >
                Save
              </button>
            </div>
          </form>
        ))}
      </div>

      {/* Reseller authority — the owner's to give, and to take back. */}
      <div className="mt-6 rounded-2xl border hairline bg-surface-1 px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="eyebrow">Let partners help sell it</p>
          <span
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] ${
              resaleAllowed
                ? "border-emerald-600/45 bg-emerald-500/10 text-emerald-300"
                : "border-ink-700 text-ink-500"
            }`}
          >
            {resaleAllowed ? "Allowed" : "Not allowed"}
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-400">
          As well as Lode, you can allow vetted partners — regulated agents — to market your
          property to their own buyers. You stay in control of the sale and there is nothing extra
          for you to pay; the partner is paid out of their own arrangement, never by you. You can
          change this whenever you like.
        </p>
        <form action={setResaleConsent} className="mt-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="allow" value={resaleAllowed ? "no" : "yes"} />
          <button
            type="submit"
            className={`inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors ${
              resaleAllowed
                ? "border hairline bg-surface-2 text-ink-200 hover:border-ink-500"
                : "bg-lode-400 text-ink-950 hover:bg-lode-300 active:bg-lode-500"
            }`}
          >
            {resaleAllowed ? "Withdraw partner access" : "Allow partners to market it"}
          </button>
        </form>
      </div>
    </section>
  );
}

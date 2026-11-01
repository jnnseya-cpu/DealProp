import { SELLER_KINDS, type SellerDueDiligence } from "@shared/domain/sellerDueDiligence";
import type { StatedIdentity } from "@shared/domain/types";
import { recordSellerDetails } from "../actions";

/**
 * The seller tells us who they are and their authority to sell.
 *
 * The lawful half of the seller's due diligence: the owner's own account of
 * their kind and their authority, which they can give. The other half —
 * verifying it — is ours to do and cannot be done here, so the section says so
 * plainly and never implies providing this completes the check.
 */
export function SellerDetailsSection({
  id,
  checks,
  identity,
  notice,
}: {
  id: string;
  checks: SellerDueDiligence | undefined;
  identity: StatedIdentity | undefined;
  notice?: boolean;
}) {
  return (
    <section id="about" className="mt-10 scroll-mt-6 rounded-2xl border hairline bg-surface-1 px-5 py-4">
      <p className="eyebrow">Who&rsquo;s selling</p>
      <h2 className="mt-2 font-display text-[18px] leading-tight text-ink-100">
        Tell us who you are
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-400">
        We&rsquo;re required to check who is selling and that they may sell — for every property,
        it&rsquo;s the law. Telling us now gives us a head start. We will still verify it with you;
        filling this in does not complete that check.
      </p>

      {notice === true && (
        <p className="mt-4 rounded-lg border-l-2 border-emerald-500 bg-surface-2 px-5 py-3 text-sm text-ink-200">
          Thank you — we&rsquo;ve noted that, and we&rsquo;ll be in touch to verify it.
        </p>
      )}

      <form action={recordSellerDetails} className="mt-4">
        <input type="hidden" name="id" value={id} />
        <label className="block">
          <span className="block text-sm text-ink-200">What best describes you?</span>
          <select
            name="kind"
            defaultValue={checks?.kind ?? "individual"}
            className="mt-2 w-full rounded-xl border hairline bg-surface-2 px-4 py-3 text-sm text-ink-100 focus:border-lode-500/60 focus:outline-none sm:w-80"
          >
            {SELLER_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="block text-sm text-ink-200">Your full legal name</span>
            <input
              name="legalName"
              defaultValue={identity?.legalName ?? ""}
              maxLength={160}
              placeholder="As it appears on your ID"
              className="mt-2 w-full rounded-xl border hairline bg-surface-2 px-4 py-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-lode-500/60 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="block text-sm text-ink-200">Date of birth</span>
            <input
              type="date"
              name="dateOfBirth"
              defaultValue={identity?.dateOfBirth ?? ""}
              className="mt-2 w-full rounded-xl border hairline bg-surface-2 px-4 py-3 text-sm text-ink-100 focus:border-lode-500/60 focus:outline-none"
            />
          </label>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ink-500">
          We ask for these because an identity check is run against them. They&rsquo;re kept
          encrypted and used only to verify who you are.
        </p>

        <label className="mt-5 block">
          <span className="block text-sm text-ink-200">Your authority to sell</span>
          <span className="mt-0.5 block text-xs text-ink-500">
            In your own words — for example &ldquo;I am the sole registered owner&rdquo;, or
            &ldquo;I am the executor, grant of probate issued on …&rdquo;.
          </span>
          <textarea
            name="authority"
            rows={3}
            defaultValue={checks?.authorityEvidence ?? ""}
            maxLength={600}
            placeholder="How you come to be entitled to sell this property."
            className="mt-2 w-full rounded-xl border hairline bg-surface-2 px-4 py-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-lode-500/60 focus:outline-none"
          />
        </label>

        <button
          type="submit"
          className="mt-4 inline-flex h-9.5 items-center justify-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300 active:bg-lode-500"
        >
          Save
        </button>
      </form>
    </section>
  );
}

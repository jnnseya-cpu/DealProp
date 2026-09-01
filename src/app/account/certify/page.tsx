import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/app/components/chrome";
import { certificationStatus } from "@shared/domain/accounts";
import { UK_INVESTOR_CATEGORISATION } from "@shared/domain/jurisdictions/uk-financial-promotion";
import { currentViewer } from "@/app/operator/guard";
import { CertifyForm } from "./CertifyForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Investor certification — Lode",
};

/**
 * Investor self-certification.
 *
 * The page that unblocks sending deal material at all. A deal pack to a private
 * investor is a financial promotion under FSMA s.21; the exemptions turn on the
 * investor certifying which category they fall into, and this is where they do
 * it.
 *
 * Categories requiring a third party's signature are shown but not offered as a
 * form, because this platform cannot issue one and a form that looks as though
 * it can is worse than no form.
 */
export default async function CertifyPage() {
  const viewer = await currentViewer();
  if (viewer === undefined) redirect("/operator?next=%2Faccount%2Fcertify");
  if (viewer.kind !== "account") {
    redirect(
      "/operator/denied?reason=" +
        encodeURIComponent(
          "Certification attaches to a person. Sign in with your own account rather than the shared operator password.",
        ),
    );
  }

  const status = certificationStatus(viewer.account);
  const selfCertifiable = UK_INVESTOR_CATEGORISATION.categories.filter(
    (c) => !c.requiresThirdPartyCertification,
  );
  const thirdParty = UK_INVESTOR_CATEGORISATION.categories.filter(
    (c) => c.requiresThirdPartyCertification,
  );

  return (
    <main className="min-h-screen">
      <SiteHeader width="max-w-2xl" />

      <div className="mx-auto max-w-2xl px-6 py-10">
        <p className="eyebrow">
          Investor certification
        </p>
        <h1 className="mt-2 font-display text-[26px] leading-tight text-ink-100">
          Before we can send you a deal
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-300">
          A deal pack sent to a private investor is a financial promotion under section 21 of the
          Financial Services and Markets Act 2000. We are not authorised to approve one, so we rely
          on the exemptions — and those turn on you telling us, in writing, which category you fall
          into. It takes a minute and lasts{" "}
          {UK_INVESTOR_CATEGORISATION.certificationValidMonths} months.
        </p>

        <div
          className={`mt-8 rounded-2xl border px-5 py-4 ${
            status.current
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-amber-500/25 bg-amber-500/5"
          }`}
        >
          <p className="eyebrow">Where you stand</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-200">{status.reason}</p>
        </div>

        <div className="mt-10">
          <CertifyForm categories={selfCertifiable} />
        </div>

        {thirdParty.length > 0 && (
          <section className="mt-10 rounded-2xl border hairline bg-surface-1 px-5 py-4">
            <p className="eyebrow">
              Not something we can issue
            </p>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-300">
              {thirdParty.map((c) => (
                <li key={c.category}>
                  <strong className="text-ink-100">{c.label}</strong> ({c.citation}) must be signed
                  by an authorised person. If you hold one, send it to us rather than completing the
                  form above.
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-8 text-xs leading-relaxed text-ink-500">
          Thresholds recorded as at {UK_INVESTOR_CATEGORISATION.asOf}
          {UK_INVESTOR_CATEGORISATION.requiresVerification
            ? " and pending verification against the current Order — they were amended and the amendment was then announced for reversal."
            : "."}{" "}
          Sources: {UK_INVESTOR_CATEGORISATION.sources.join("; ")}.{" "}
          <Link href="/" className="text-lode-300 underline-offset-2 hover:underline">
            Back to the start
          </Link>
        </p>
      </div>
    </main>
  );
}

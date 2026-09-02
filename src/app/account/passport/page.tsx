import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Panel, SiteHeader, Stat } from "@/app/components/chrome";
import { currentViewer } from "@/app/operator/guard";
import {
  buyerPassport,
  FUNDS_VALID_MONTHS,
  GRADES,
  IDENTITY_VALID_MONTHS,
} from "@shared/domain/passport";
import { gbp } from "@shared/format";
import { fromMajor, toMajor } from "@shared/money";
import { FundsForm, IdentityForm, SolicitorForm } from "./Forms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Buyer Readiness Passport — Lode" };

/**
 * The Buyer Readiness Passport, from the buyer's side.
 *
 * A seller in difficulty has a finite amount of patience and one thing to
 * sell. Spending it on a buyer who turns out to have no money is how a
 * motivated-seller marketplace destroys its own supply — and the seller does
 * not blame the buyer, they blame whoever introduced them. So this is the gate
 * on being introduced at all, and the page says so rather than presenting the
 * grade as a loyalty tier.
 *
 * The grade shown here is against a reference price, because "funded" is not
 * an absolute and a passport with no property in mind is graded against
 * nothing. Each opportunity re-grades against its own price.
 */
const REFERENCE_PRICE = fromMajor(200_000);

/** Date inputs want yyyy-mm-dd, and an unreadable stored date shows as blank. */
function dateValue(iso: string | undefined): string | undefined {
  if (iso === undefined) return undefined;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString().slice(0, 10);
}

export default async function PassportPage() {
  const viewer = await currentViewer();
  if (viewer === undefined) redirect("/operator?next=%2Faccount%2Fpassport");
  if (viewer.kind !== "account") {
    redirect(
      "/operator/denied?reason=" +
        encodeURIComponent(
          "A passport belongs to a person. Sign in with your own account rather than the shared operator password.",
        ),
    );
  }

  const evidence = viewer.account.passportEvidence ?? {};
  const passport = buyerPassport(evidence, REFERENCE_PRICE, new Date());
  const proof = evidence.proofOfFunds;

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        back="/opportunities"
        trailing={
          <nav className="flex items-center gap-5 text-[13px] text-ink-400">
            <Link href="/opportunities" className="transition-colors hover:text-ink-100">
              Opportunities
            </Link>
            <Link href="/account/certify" className="transition-colors hover:text-ink-100">
              Certification
            </Link>
          </nav>
        }
      />

      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="eyebrow">Buyer Readiness Passport</p>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          Grade {passport.grade} — {passport.definition.label}
        </h1>
        <p className="mt-4 max-w-[38rem] text-[14px] leading-[1.6] text-ink-400">
          {passport.definition.meaning}
        </p>
        <p className="mt-3 max-w-[38rem] text-[13px] leading-[1.6] text-ink-500">
          This is the gate on being introduced to a seller, not a loyalty tier. A motivated seller
          has finite patience and one property to sell; we do not spend it on a buyer nobody has
          checked. Graded here against a {gbp(REFERENCE_PRICE)} purchase — each opportunity is
          re-graded against its own price.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-6 border-y hairline py-6 sm:grid-cols-3">
          <Stat label="Grade" value={passport.grade} size="sm" />
          <Stat label="Funds evidenced" value={gbp(passport.evidencedFunds)} size="sm" />
          <Stat
            label="May be introduced"
            value={passport.mayApproachSeller ? "Yes" : "Not yet"}
            size="sm"
            tone={passport.mayApproachSeller ? "text-emerald-300" : "text-amber-300"}
          />
        </div>

        <Panel className="mt-8" eyebrow="What is recorded" title="Every check, and what it proves">
          <ul className="space-y-2.5">
            {passport.checks.map((check) => (
              <li key={check.label} className="text-[13px] leading-[1.6]">
                <span className={check.held ? "text-ink-100" : "text-amber-300"}>
                  {check.held ? "✓" : "—"} {check.label}
                </span>{" "}
                <span className="text-ink-500">{check.detail}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t hairline pt-4 text-[12px] leading-[1.6] text-ink-500">
            {passport.caveat} An identity check stands for {IDENTITY_VALID_MONTHS} months and funds
            evidence for {FUNDS_VALID_MONTHS}, because a check that stale is not a check and a bank
            balance is a photograph of a number that moves.
          </p>
        </Panel>

        <Panel className="mt-6" eyebrow="Who you are" title="Identity and screening">
          <IdentityForm
            {...(evidence.identityMethod !== undefined ? { method: evidence.identityMethod } : {})}
            {...(dateValue(evidence.identityVerifiedAt) !== undefined
              ? { verifiedAt: dateValue(evidence.identityVerifiedAt) }
              : {})}
            {...(dateValue(evidence.screenedAt) !== undefined
              ? { screenedAt: dateValue(evidence.screenedAt) }
              : {})}
          />
        </Panel>

        <Panel className="mt-6" eyebrow="What you can pay with" title="Evidence of funds">
          <p className="text-[13px] leading-[1.65] text-ink-300">
            The date wanted is the date on the evidence itself, not the date you upload it. A
            statement showing last February&rsquo;s balance is February&rsquo;s evidence, and
            treating it as today&rsquo;s is how a stale balance passes a freshness check.
          </p>
          <div className="mt-4 border-t hairline pt-4">
            <FundsForm
              {...(proof?.kind !== undefined ? { kind: proof.kind } : {})}
              {...(proof?.issuer !== undefined ? { issuer: proof.issuer } : {})}
              {...(proof?.amount !== undefined ? { amount: String(toMajor(proof.amount)) } : {})}
              {...(dateValue(proof?.evidencedAt) !== undefined
                ? { evidencedAt: dateValue(proof?.evidencedAt) }
                : {})}
              {...(dateValue(proof?.expiresAt) !== undefined
                ? { expiresAt: dateValue(proof?.expiresAt) }
                : {})}
            />
          </div>
        </Panel>

        <Panel className="mt-6" eyebrow="Ready to act" title="Your conveyancer">
          <SolicitorForm
            {...(evidence.solicitor !== undefined ? { solicitor: evidence.solicitor } : {})}
          />
        </Panel>

        <Panel className="mt-6" eyebrow="The grades" title="What each one means">
          <ul className="space-y-3">
            {GRADES.map((grade) => (
              <li key={grade.grade} className="text-[13px] leading-[1.6]">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-ink-100">
                    {grade.grade} — {grade.label}
                  </span>
                  <Badge tone={grade.mayApproachSeller ? "good" : "neutral"}>
                    {grade.mayApproachSeller ? "Reaches a seller" : "Does not"}
                  </Badge>
                </span>
                <span className="mt-1 block text-ink-500">{grade.meaning}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </main>
  );
}

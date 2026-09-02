import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Panel, SiteHeader, Stat } from "@/app/components/chrome";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { audit } from "@backend/audit";
import { getDeal } from "@backend/store/repository";
import { sellerDueDiligence, SELLER_CHECK_VALID_MONTHS } from "@shared/domain/sellerDueDiligence";
import { AuthorityForm, IdentityForm, RiskForm } from "./Forms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Seller checks — Lode" };

/**
 * Customer due diligence on the seller.
 *
 * The Regulations make us responsible for both parties, not the one who is
 * paying. The page is ordered by the question rather than by the paperwork:
 * who are they, may they sell it, who is behind it, and what did somebody
 * decide about the risk — because the middle one is where transactions
 * actually fail, and it is the one nobody asks until exchange.
 */
export default async function SellerChecksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requirePermission("view-seller-data", `/deals/${id}/seller-checks`);
  const record = await getDeal(id);
  if (record === undefined) notFound();

  const named = viewerAccount(viewer);
  await audit("viewed-deal-material", {
    ...(named !== undefined ? { account: named } : {}),
    subject: record.id,
    detail: `${record.reference} (seller checks)`,
  });

  const checks = record.sellerChecks;
  const report = sellerDueDiligence(checks, new Date());
  const held = report.checks.filter((c) => c.held).length;

  return (
    <main className="min-h-screen pb-20">
      <SiteHeader
        back={`/deals/${record.id}`}
        trailing={
          <nav className="flex items-center gap-5 text-[13px] text-ink-400">
            <Link href={`/deals/${record.id}`} className="transition-colors hover:text-ink-100">
              Deal Room
            </Link>
            <Link href={`/deals/${record.id}/material`} className="transition-colors hover:text-ink-100">
              Material
            </Link>
          </nav>
        }
      >
        <span className="font-mono text-xs text-ink-500">{record.reference}</span>
      </SiteHeader>

      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="eyebrow">Seller checks</p>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {report.mayGoToMarket ? "May go to market" : "May not go to market yet"}
        </h1>
        <p className="mt-4 max-w-[38rem] text-[14px] leading-[1.6] text-ink-400">{report.summary}</p>
        <p className="mt-3 max-w-[38rem] text-[13px] leading-[1.6] text-ink-500">
          The Money Laundering Regulations make an estate agency business responsible for checking
          both parties, not the one who happens to be paying. Every check stands for{" "}
          {SELLER_CHECK_VALID_MONTHS} months and then has to be done again.
        </p>

        <div className="mt-8 grid grid-cols-3 gap-6 border-y hairline py-6">
          <Stat label="Checks held" value={`${held} of ${report.checks.length}`} size="sm" />
          <Stat label="Seller" value={report.kind.label} size="sm" tone="text-ink-300" />
          <Stat
            label="Enhanced"
            value={report.enhanced ? "Triggered" : "No"}
            size="sm"
            tone={report.enhanced ? "text-amber-300" : "text-ink-300"}
          />
        </div>

        <Panel
          className="mt-8"
          eyebrow="Where it stands"
          title="Every check, and what is missing"
          action={
            <Badge tone={report.mayGoToMarket ? "good" : "warn"}>
              {report.mayGoToMarket ? "Complete" : `${report.blockers.length} outstanding`}
            </Badge>
          }
        >
          <ul className="space-y-2.5">
            {report.checks.map((check) => (
              <li key={check.label} className="text-[13px] leading-[1.6]">
                <span className={check.held ? "text-ink-100" : check.blocking ? "text-amber-300" : "text-ink-400"}>
                  {check.held ? "✓" : "—"} {check.label}
                </span>{" "}
                <span className="text-ink-500">{check.detail}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="mt-6" eyebrow="Who are they" title="Identity and screening">
          <IdentityForm
            dealId={record.id}
            {...(checks?.kind !== undefined ? { kind: checks.kind } : {})}
            {...(checks?.identityMethod !== undefined ? { method: checks.identityMethod } : {})}
          />
        </Panel>

        <Panel className="mt-6" eyebrow="May they sell it" title={report.kind.label}>
          <p className="text-[13px] leading-[1.65] text-ink-300">
            {report.kind.authorityEvidence} The person on the telephone is very often not the
            registered proprietor, and a transaction that reaches exchange before anybody asks is a
            transaction that fails at exchange.
          </p>
          <div className="mt-4 border-t hairline pt-4">
            <AuthorityForm
              dealId={record.id}
              expected={report.kind.authorityEvidence}
              {...(checks?.authorityEvidence !== undefined
                ? { evidence: checks.authorityEvidence }
                : {})}
            />
          </div>
        </Panel>

        <Panel className="mt-6" eyebrow="What was decided" title="Risk assessment">
          <p className="text-[13px] leading-[1.65] text-ink-300">
            HMRC expects a documented, risk-based framework and treats property as a high-risk
            sector. An undocumented judgement is indistinguishable from none.
          </p>
          <div className="mt-4 border-t hairline pt-4">
            <RiskForm
              dealId={record.id}
              triggers={checks?.enhancedTriggers ?? []}
              {...(checks?.enhancedMeasures !== undefined
                ? { measures: checks.enhancedMeasures }
                : {})}
            />
          </div>
        </Panel>
      </div>
    </main>
  );
}

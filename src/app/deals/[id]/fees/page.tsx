import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Panel, SiteHeader, Stat } from "@/app/components/chrome";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { audit } from "@backend/audit";
import { feesForDeal } from "@backend/billing/fees";
import { permissionSet } from "@backend/permissions";
import { permissionDefinition } from "@shared/domain/permissions";
import { gbp } from "@shared/format";
import { ZERO } from "@shared/money";
import { DisclosureForm, RaiseFeeForm, VoidFeeForm } from "./Forms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Fees — Lode" };

/**
 * What may be invoiced on this deal, and what is stopping the rest.
 *
 * The revenue model has always been able to say a completed deal is worth
 * £2,760. Nothing could ever collect a penny of it, because there was no path
 * from the model to an invoice — the four transaction streams were rendered on
 * two marketing surfaces and called by nothing.
 *
 * This is that path, and it is deliberately obstructive. A fee needs the
 * permission, the stage, the disclosure and a named person, and the page shows
 * every one that is missing at once rather than revealing them one at a time.
 */
export default async function FeesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requirePermission("view-seller-data", `/deals/${id}/fees`);
  const view = await feesForDeal(id);
  if (view === undefined) notFound();

  const { record, position, raised } = view;
  const permissions = permissionSet();
  const named = viewerAccount(viewer);

  await audit("viewed-deal-material", {
    ...(named !== undefined ? { account: named } : {}),
    subject: record.id,
    detail: `${record.reference} (fees)`,
  });

  const live = raised.filter((f) => f.voidedAt === undefined);

  return (
    <main className="min-h-screen pb-20">
      <SiteHeader
        back="/deals"
        trailing={
          <nav className="flex items-center gap-5 text-[13px] text-ink-400">
            <Link href="/deals" className="transition-colors hover:text-ink-100">Deals</Link>
            <Link href={`/deals/${record.id}`} className="transition-colors hover:text-ink-100">Deal Room</Link>
            <Link href={`/deals/${record.id}/funding`} className="transition-colors hover:text-ink-100">Funding</Link>
          </nav>
        }
      >
        <span className="font-mono text-xs text-ink-500">{record.reference}</span>
      </SiteHeader>

      <div className="mx-auto max-w-4xl px-6 py-10">
        <p className="eyebrow">Fees</p>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {position.chargeableNow > ZERO
            ? `${gbp(position.chargeableNow)} may be invoiced.`
            : "Nothing may be invoiced yet."}
        </h1>
        <p className="mt-4 max-w-[38rem] text-[14px] leading-[1.6] text-ink-400">
          {position.summary}
        </p>

        <div className="mt-8 grid grid-cols-2 gap-6 border-y hairline py-6 sm:grid-cols-4">
          <Stat label="Chargeable now" value={gbp(position.chargeableNow)} size="sm" />
          <Stat label="Blocked" value={gbp(position.blocked)} size="sm" />
          <Stat label="Already raised" value={gbp(position.raised)} size="sm" />
          <Stat
            label="Deal stage"
            value={record.status}
            size="sm"
            tone="text-ink-300"
          />
        </div>

        {/* --- the disclosure, first, because it has to be ---------------- */}
        <Panel
          className="mt-8"
          eyebrow="Before any of it"
          title="What the seller was told"
          action={
            record.feeDisclosure !== undefined ? (
              <Badge tone="good">Recorded</Badge>
            ) : (
              <Badge tone="warn">Not recorded</Badge>
            )
          }
        >
          <p className="text-[13px] leading-[1.65] text-ink-300">
            The Estate Agents Act 1979 s.18 requires the client to be told the fees before they are
            bound by anything, and an undisclosed referral fee is a misleading omission under the
            Consumer Protection from Unfair Trading Regulations. A fee the seller was never told
            about is unenforceable — so this is the step that makes the money collectable, not the
            step that delays it.
          </p>

          {record.feeDisclosure !== undefined && (
            <p className="mt-3.5 border-l-2 border-emerald-500/80 py-1 pl-4 text-[13px] leading-[1.65] text-ink-200">
              &ldquo;{record.feeDisclosure.wording}&rdquo;
              <span className="mt-1 block font-mono text-[11px] text-ink-500">
                {record.feeDisclosure.by} · {record.feeDisclosure.at.slice(0, 16).replace("T", " ")}
              </span>
            </p>
          )}

          <div className="mt-4 border-t hairline pt-4">
            <DisclosureForm
              dealId={record.id}
              {...(record.feeDisclosure !== undefined
                ? { current: record.feeDisclosure.wording }
                : {})}
            />
          </div>
        </Panel>

        {/* --- each fee --------------------------------------------------- */}
        <div className="mt-8 space-y-4">
          {position.fees.map((fee) => (
            <article
              key={fee.definition.key}
              className={`rounded-r-lg border-y border-r border-l-2 hairline bg-surface-1 px-5 py-4 ${
                fee.chargeable
                  ? "border-l-emerald-500/80"
                  : fee.alreadyRaised
                    ? "border-l-ink-600"
                    : "border-l-amber-500/80"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-display text-[18px] leading-tight text-ink-100">
                  {fee.definition.label}
                </h2>
                <span className="tnum text-[18px] text-ink-100">{gbp(fee.amount)}</span>
              </div>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-ink-400">
                {fee.definition.basis} Paid by the {fee.definition.payer}.
              </p>

              {fee.chargeable ? (
                <RaiseFeeForm
                  dealId={record.id}
                  feeKey={fee.definition.key}
                  label={fee.definition.label}
                />
              ) : (
                <ul className="mt-3.5 space-y-2.5 border-t hairline pt-3.5">
                  {fee.blockers.map((blocker) => (
                    <li key={blocker.reason} className="text-[13px] leading-[1.6]">
                      <span className="text-ink-200">{blocker.reason}</span>{" "}
                      <span className="text-ink-500">{blocker.remedy}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>

        {/* --- what has been raised --------------------------------------- */}
        {raised.length > 0 && (
          <Panel className="mt-8" eyebrow="Raised" title={`${live.length} live, ${raised.length - live.length} voided`}>
            <ul className="space-y-4">
              {raised.map((fee) => (
                <li key={fee.id} className="border-b hairline pb-4 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <span className="text-[14px] text-ink-100">
                      {fee.feeKey.replace(/-/g, " ")}
                      {fee.voidedAt !== undefined && (
                        <Badge className="ml-2" tone="neutral">Voided</Badge>
                      )}
                    </span>
                    <span
                      className={`tnum text-[14px] ${fee.voidedAt !== undefined ? "text-ink-500 line-through" : "text-ink-100"}`}
                    >
                      {gbp(fee.amount)}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] leading-[1.6] text-ink-400">{fee.note}</p>
                  <p className="mt-1 font-mono text-[11px] text-ink-600">
                    {fee.raisedByName} · {fee.raisedAt.slice(0, 16).replace("T", " ")} ·{" "}
                    {fee.permissionsAtRaise.length > 0
                      ? `under ${fee.permissionsAtRaise.join(", ")}`
                      : "no permissions recorded"}
                  </p>
                  {fee.voidedAt !== undefined ? (
                    <p className="mt-1 text-[12px] leading-[1.6] text-ink-500">
                      Voided by {fee.voidedBy} — {fee.voidReason}
                    </p>
                  ) : (
                    <VoidFeeForm dealId={record.id} feeId={fee.id} />
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {/* --- what is recorded ------------------------------------------- */}
        <Panel className="mt-8" eyebrow="Permissions" title="What is recorded as held">
          {permissions.held.length === 0 ? (
            <p className="text-[13px] leading-[1.65] text-amber-300">
              None. Every transaction fee is blocked, which is the correct state until the
              supervision behind it exists — charging without it is an offence for two of these and
              makes the fee unrecoverable for a third.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {permissions.held.map((held) => {
                const definition = permissionDefinition(held.key);
                return (
                  <li key={held.key} className="text-[13px] leading-[1.6]">
                    <span className="text-ink-100">{definition.label}</span>{" "}
                    <span className="font-mono text-[12px] text-lode-300">{held.evidence}</span>
                    <span className="block text-ink-500">
                      {definition.regulator} · {definition.authorises}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {permissions.unevidenced.length > 0 && (
            <p className="mt-3.5 border-t hairline pt-3.5 text-[13px] leading-[1.6] text-amber-300">
              {permissions.unevidenced.map((k) => permissionDefinition(k).label).join(", ")} named
              with no evidence recorded, so nothing is granted by it.
            </p>
          )}
        </Panel>
      </div>
    </main>
  );
}

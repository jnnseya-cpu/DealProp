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
import {
  DisclosureForm,
  InstructionForm,
  RaiseFeeForm,
  RaiseResellerForm,
  SellerAgreementForm,
  VoidFeeForm,
} from "./Forms";
import { bindsSellerElsewhere } from "@shared/domain/fees";
import { successFeeBand } from "@shared/domain/pricing";
import { resellerInvoice } from "@shared/domain/reseller";

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
  const agreement = record.sellerAgreement;
  const instruction = record.existingInstruction;
  const boundElsewhere = bindsSellerElsewhere(instruction);

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

        {/* --- the seller's side ----------------------------------------- */}
        <Panel
          className="mt-6"
          eyebrow={agreement !== undefined ? "The seller pays once" : "The buyer pays our fee"}
          title={
            agreement !== undefined
              ? "What the seller signed, and who else they are instructed to"
              : "The seller pays nothing on this deal"
          }
          action={
            agreement === undefined ? (
              <Badge tone="good">Free to the seller</Badge>
            ) : !boundElsewhere ? (
              <Badge tone="good">Clear</Badge>
            ) : (
              <Badge tone="warn">Bound elsewhere</Badge>
            )
          }
        >
          {agreement === undefined ? (
            <p className="text-[13px] leading-[1.65] text-ink-300">
              On this deal the seller sells to a cash buyer we introduce and pays nothing — our fee
              comes from the buyer, not from them (we never own the property). A seller fee exists on
              one route only — where the seller instead instructs us to sell their property{" "}
              <em>for</em> them, an agency sale. If that is what they have chosen, record the signed
              agency terms below and a seller success fee will apply; until then there is nothing for
              the seller to pay, and no seller line appears against this deal.
            </p>
          ) : (
            <p className="text-[13px] leading-[1.65] text-ink-300">
              The seller pays a percentage of the price achieved, on completion and at no other
              point. Two things have to be true before it may be raised. They have to have signed
              for it — a percentage nobody agreed to is not a fee. And they must not still be
              instructed under sole agency or sole selling rights, where their existing agent is
              paid on a sale whoever introduced the buyer: charging on top of that makes them pay
              twice for one completion.
            </p>
          )}

          <div className="mt-4 border-t hairline pt-4">
            {agreement !== undefined && (
              <p className="mb-3.5 border-l-2 border-emerald-500/80 py-1 pl-4 text-[13px] leading-[1.65] text-ink-200">
                {agreement.signedBy} signed the {successFeeBand(agreement.service).label.toLowerCase()}{" "}
                terms.
                <span className="mt-1 block font-mono text-[11px] text-ink-500">
                  {agreement.termsVersion} · {agreement.signedAt.slice(0, 16).replace("T", " ")}
                </span>
              </p>
            )}
            <SellerAgreementForm
              dealId={record.id}
              {...(agreement !== undefined
                ? { current: { signedBy: agreement.signedBy, service: agreement.service } }
                : {})}
            />
          </div>

          <div className="mt-5 border-t hairline pt-4">
            {instruction !== undefined && (
              <p
                className={`mb-3.5 border-l-2 py-1 pl-4 text-[13px] leading-[1.65] text-ink-200 ${
                  boundElsewhere ? "border-amber-500/80" : "border-emerald-500/80"
                }`}
              >
                {instruction.kind === "none"
                  ? "No agent instructed."
                  : `${instruction.agent} — ${instruction.kind.replace(/-/g, " ")}.`}
                {instruction.releasedAt !== undefined && (
                  <span className="mt-1 block font-mono text-[11px] text-ink-500">
                    Released {instruction.releasedAt.slice(0, 10)} · recorded by{" "}
                    {instruction.releasedBy}
                  </span>
                )}
              </p>
            )}
            <InstructionForm
              dealId={record.id}
              {...(instruction !== undefined
                ? {
                    current: {
                      kind: instruction.kind,
                      agent: instruction.agent,
                      released: instruction.releasedAt !== undefined,
                    },
                  }
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

        {/* --- the reseller's cut, where a partner took the listing on ----- */}
        {record.resale !== undefined && (() => {
          const resale = record.resale;
          const resellerRaised = live.some((f) => f.feeKey === "reseller-commission");
          const invoice = resellerInvoice({
            arrangement: resale,
            permissionsHeld: permissions.held.map((h) => h.key),
            status: record.status,
            alreadyRaised: resellerRaised,
          });
          return (
            <Panel
              className="mt-8"
              eyebrow="Reseller"
              title="A partner is marketing this listing"
              action={
                <Badge tone={resellerRaised ? "neutral" : invoice.chargeable ? "good" : "warn"}>
                  {resellerRaised ? "Raised" : gbp(invoice.amount)}
                </Badge>
              }
            >
              <p className="text-[13px] leading-[1.65] text-ink-300">
                {resale.resellerName} took this on, with a fee of {gbp(resale.feeAgreed)} on the
                onward sale. Lode&rsquo;s cut is a share of that fee — {gbp(invoice.amount)} — never
                of the property price, due on completion.
              </p>
              {resellerRaised ? (
                <p className="mt-3.5 border-t hairline pt-3.5 text-[13px] leading-[1.6] text-ink-400">
                  The cut has been raised. It appears below with the other raised fees, where it can
                  be voided.
                </p>
              ) : invoice.chargeable ? (
                <RaiseResellerForm dealId={record.id} />
              ) : (
                <ul className="mt-3.5 space-y-2.5 border-t hairline pt-3.5">
                  {invoice.blockers.map((b) => (
                    <li key={b} className="text-[13px] leading-[1.6] text-ink-400">{b}</li>
                  ))}
                </ul>
              )}
            </Panel>
          );
        })()}

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

import { redirect } from "next/navigation";
import { OperatorNav } from "@/app/operator/OperatorNav";
import { AccountNav } from "@/app/account/AccountNav";
import { Panel, SiteHeader } from "@/app/components/chrome";
import { currentViewer } from "@/app/operator/guard";
import { getDeal, listRevealsForAccount } from "@backend/store/repository";
import { dealWorkflowFacts } from "@backend/workflow";
import { workflowPosition } from "@shared/domain/workflow";
import { isHolderKind } from "@shared/domain/reservation";
import {
  SOURCER_EXCEPTIONS,
  SOURCER_PREREQUISITES,
  SOURCER_WALKTHROUGH,
  sourcerWalkthrough,
  type WalkState,
  type WalkStepStatus,
  type WalkthroughView,
} from "@shared/domain/sourcerWalkthrough";
import type { DealStatus } from "@shared/domain/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sourcer walkthrough — Lode" };

/**
 * The sourcer/flipper walkthrough, live against the deals they hold.
 *
 * It is the operational half of `workflow.ts`, scoped to the person who found
 * the deal and gets paid on it. For every deal this account has revealed as a
 * holder (sourcer or flipper), the current stage is read from the same engine
 * the Deal Room uses — reached is reached because the evidence exists, never
 * because a box was ticked here — and the sourcer's actions, scripts and
 * compliance obligations for that stage are shown beside it. Figures (the max
 * offer, SDLT, the walk-away, the fee) are each computed on their own surface;
 * this is the map and the method, never a model.
 */

const STATE_LABEL: Record<WalkState, string> = {
  done: "Done",
  current: "Now",
  upcoming: "Next",
};

// Progress states are not a verdict, so they never borrow the reserved
// red-amber-green. "Now" carries the page accent; done and upcoming are ink.
const STATE_CLASS: Record<WalkState, string> = {
  done: "text-ink-500",
  current: "text-[var(--accent-text)]",
  upcoming: "text-ink-600",
};

function Steps({ view }: { view: WalkthroughView }) {
  return (
    <ol className="mt-4 space-y-1.5">
      {view.steps.map((s, i) => (
        <li key={s.step.key} className="flex items-baseline gap-3 text-sm">
          <span className="w-5 shrink-0 text-right font-mono text-xs text-ink-600 tabular-nums">{i + 1}</span>
          <span className={`w-11 shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] ${STATE_CLASS[s.state]}`}>
            {STATE_LABEL[s.state]}
          </span>
          <span className={s.state === "upcoming" ? "text-ink-400" : "text-ink-200"}>{s.step.title}</span>
        </li>
      ))}
    </ol>
  );
}

function CurrentStep({ status }: { status: WalkStepStatus }) {
  const { step } = status;
  return (
    <div className="mt-5 rounded-2xl border hairline bg-surface-2 px-5 py-4">
      <span className="eyebrow">Do now</span>
      <h3 className="mt-1.5 font-display text-base text-ink-100">{step.title}</h3>
      {status.detail !== "" && <p className="mt-1 text-xs text-ink-500">{status.detail}</p>}

      <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-ink-500">What you do</p>
      <ul className="mt-2 space-y-1.5">
        {step.actions.map((a, i) => (
          <li key={i} className="text-sm leading-relaxed text-ink-300">{a}</li>
        ))}
      </ul>

      {step.obligations.length > 0 && (
        <>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-ink-500">Keep it lawful</p>
          <ul className="mt-2 space-y-2">
            {step.obligations.map((o, i) => (
              <li key={i} className="border-l-2 border-[var(--accent)]/60 pl-3 text-sm leading-relaxed text-ink-300">
                {o}
              </li>
            ))}
          </ul>
        </>
      )}

      {step.script !== undefined && (
        <p className="mt-4 border-l-2 border-ink-700 pl-3 text-sm italic leading-relaxed text-ink-300">
          “{step.script}”
        </p>
      )}

      {step.feeNote !== undefined && (
        <p className="mt-4 text-sm leading-relaxed text-ink-200">
          <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--accent-text)]">Getting paid </span>
          {step.feeNote}
        </p>
      )}
    </div>
  );
}

export default async function SourcerPlaybook() {
  const viewer = await currentViewer();
  if (viewer === undefined) redirect("/operator?next=%2Faccount%2Fplaybook");

  if (viewer.kind !== "account") {
    return (
      <main className="min-h-screen" data-accent="teal">
        <SiteHeader trailing={<OperatorNav current="/account/playbook" />} />
        <div className="mx-auto max-w-2xl px-6 py-16">
          <span className="eyebrow">Sourcer walkthrough</span>
          <h1 className="mt-2 font-display text-[26px] leading-tight text-ink-100">A personal surface</h1>
          <p className="mt-4 text-sm leading-relaxed text-ink-300">
            The walkthrough tracks the deals a signed-in sourcer or flipper holds. Sign in with an account
            to see it against your own deals.
          </p>
        </div>
      </main>
    );
  }

  const account = viewer.account;

  // The deals this account holds as a sourcer or flipper: a reveal it paid for,
  // not refunded, whose kind counts toward a hold. An investor reveal is a
  // separate channel and is not a sourcing engagement.
  const reveals = await listRevealsForAccount(account.id);
  const holderDealIds = [
    ...new Set(
      reveals
        .filter((r) => r.refundedAt === undefined && r.revealerKind !== undefined && isHolderKind(r.revealerKind))
        .map((r) => r.dealId),
    ),
  ];

  const deals = (await Promise.all(holderDealIds.map((id) => getDeal(id)))).filter(
    (d): d is NonNullable<typeof d> => d !== undefined,
  );

  const live = await Promise.all(
    deals.map(async (deal) => {
      const position = workflowPosition(await dealWorkflowFacts(deal));
      return { deal, view: sourcerWalkthrough(position), summary: position.summary };
    }),
  );

  const STATUS_LABEL: Record<DealStatus, string> = {
    new: "Received",
    qualified: "Being assessed",
    "in-market": "On the market",
    funded: "Funded",
    completed: "Completed",
    withdrawn: "Withdrawn",
  };

  return (
    <main className="min-h-screen pb-24" data-accent="teal">
      <SiteHeader trailing={<AccountNav current="/account/playbook" />} />

      <div className="mx-auto max-w-3xl px-6 py-10">
        <span className="eyebrow">Sourcer walkthrough</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          From first sighting to getting paid
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          The same twelve stages the deal itself moves through, told from your chair — what you do and say
          at each one, and the obligations that travel with it. Each deal you hold shows the stage it is
          actually at, read from its recorded evidence, not from anything ticked here. Every figure — the
          maximum offer, the tax, the walk-away, your fee — is computed on its own surface.
        </p>

        {/* One-time readiness */}
        <section className="mt-10">
          <h2 className="eyebrow">Before you work any deal</h2>
          <div className="mt-4 space-y-3">
            {SOURCER_PREREQUISITES.map((p) => (
              <div key={p.key} className="rounded-2xl border hairline bg-surface-1 px-5 py-4">
                <h3 className="text-sm font-medium text-ink-100">{p.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-400">{p.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Live, per-deal walkthrough */}
        <section className="mt-12">
          <h2 className="eyebrow">Your deals</h2>
          {live.length === 0 ? (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-400">
              No deals yet. When you reveal a deal as a sourcer or flipper, it appears here with its live
              stage and the next thing to do. The full walkthrough is below in the meantime.
            </p>
          ) : (
            <div className="mt-4 space-y-6">
              {live.map(({ deal, view, summary }) => {
                const pct = Math.round(view.fractionDone * 100);
                return (
                  <Panel key={deal.id} title={`Deal ${deal.id.slice(0, 8)}`} accent="teal">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-sm text-ink-300">{STATUS_LABEL[deal.status]}</p>
                      <p className="font-mono text-xs text-ink-500 tabular-nums">{pct}% of the path</p>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                      <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-ink-400">{summary}</p>

                    <CurrentStep status={view.current} />
                    {view.nextGate !== undefined && (
                      <p className="mt-4 text-sm leading-relaxed text-ink-300">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-500">To advance </span>
                        {view.nextGate}
                      </p>
                    )}

                    <details className="mt-5">
                      <summary className="cursor-pointer text-sm text-ink-400 hover:text-ink-200">
                        All twelve stages
                      </summary>
                      <Steps view={view} />
                    </details>
                  </Panel>
                );
              })}
            </div>
          )}
        </section>

        {/* Full reference */}
        <section className="mt-12">
          <h2 className="eyebrow">The walkthrough, stage by stage</h2>
          <div className="mt-4 space-y-2">
            {SOURCER_WALKTHROUGH.map((step, i) => (
              <details key={step.key} className="rounded-2xl border hairline bg-surface-1 px-5 py-4">
                <summary className="cursor-pointer text-sm font-medium text-ink-100">
                  <span className="mr-2 font-mono text-xs text-ink-600 tabular-nums">{i + 1}</span>
                  {step.title}
                </summary>
                <ul className="mt-3 space-y-1.5">
                  {step.actions.map((a, j) => (
                    <li key={j} className="text-sm leading-relaxed text-ink-300">{a}</li>
                  ))}
                </ul>
                {step.obligations.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {step.obligations.map((o, j) => (
                      <li key={j} className="border-l-2 border-[var(--accent)]/60 pl-3 text-sm leading-relaxed text-ink-400">
                        {o}
                      </li>
                    ))}
                  </ul>
                )}
                {step.script !== undefined && (
                  <p className="mt-3 border-l-2 border-ink-700 pl-3 text-sm italic leading-relaxed text-ink-400">
                    “{step.script}”
                  </p>
                )}
                {step.feeNote !== undefined && (
                  <p className="mt-3 text-sm leading-relaxed text-ink-300">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--accent-text)]">Getting paid </span>
                    {step.feeNote}
                  </p>
                )}
              </details>
            ))}
          </div>
        </section>

        {/* Exceptions */}
        <section className="mt-12">
          <h2 className="eyebrow">When a deal goes off the path</h2>
          <div className="mt-4 space-y-3">
            {SOURCER_EXCEPTIONS.map((e, i) => (
              <div key={i} className="rounded-2xl border hairline bg-surface-1 px-5 py-4">
                <h3 className="text-sm font-medium text-ink-100">{e.situation}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-400">{e.nextAction}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

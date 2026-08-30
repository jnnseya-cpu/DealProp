import Link from "next/link";
import { SiteHeader } from "@/app/components/chrome";
import { SignOutButton } from "@/app/operator/SignOutButton";
import { requirePermission } from "@/app/operator/guard";
import {
  listDeals,
  listDiscoveryCandidates,
  listOutreachMessages,
  listSuppressions,
} from "@backend/store/repository";
import { resolveTransport } from "@backend/email";
import { OUTREACH_MEASURES } from "@shared/domain/outreach";
import { DraftForm, MessageActions, SuppressForm } from "./Forms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Outreach — Lode" };

/**
 * Approaches to funders: drafted, approved, sent, and what came back.
 *
 * Composing, approving and sending are three separate actions because they are
 * three separate decisions. Nothing is sent without a named person approving
 * it, and everything is re-checked at the moment of sending — a recipient can
 * opt out in the minutes between approval and delivery, and the check that
 * matters is the later one.
 *
 * The counts shown are qualified interest and replies, not deliveries. The
 * metric a system reports is the metric it optimises, and counting sends
 * rewards sending more.
 */
const STATUS_TONE: Record<string, string> = {
  draft: "text-ink-300",
  approved: "text-amber-300",
  sent: "text-emerald-300",
  failed: "text-red-300",
  refused: "text-red-300",
};

export default async function OutreachPage() {
  await requirePermission("manage-mandates", "/operator/outreach");

  const [messages, candidates, deals, suppressions] = await Promise.all([
    listOutreachMessages(),
    listDiscoveryCandidates(),
    listDeals(),
    listSuppressions(),
  ]);

  const approved = candidates.filter((c) => c.approvedAt !== undefined);
  const transport = resolveTransport();
  const replied = messages.filter((m) => m.replyReceivedAt !== undefined);
  const interested = replied.filter((m) => m.replyClassification === "INTERESTED").length;

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/operator/discovery" className="transition hover:text-ink-100">Discovery</Link>
            <Link href="/operator/outreach" className="text-ink-100">Outreach</Link>
            <SignOutButton />
          </nav>
        }
      />

      <div className="mx-auto max-w-4xl px-6 py-14">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">
          Outreach
        </span>
        <h1 className="mt-4 font-display text-4xl leading-tight text-ink-100">
          {messages.length === 0
            ? "Nothing drafted yet"
            : `${messages.filter((m) => m.status === "sent").length} sent, ${interested} interested`}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          Measured by {OUTREACH_MEASURES.join(", ").replace(/-/g, " ")} — not by how many messages
          went out. Every send is re-checked against the suppression list at the moment it happens.
        </p>

        {transport.name === "console" && (
          <p className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-6 py-5 text-sm leading-relaxed text-amber-200">
            No email provider is configured, so sending writes the message to the server log instead
            of delivering it. Set <span className="font-mono">EMAIL_API_URL</span>,{" "}
            <span className="font-mono">EMAIL_API_KEY</span> and{" "}
            <span className="font-mono">EMAIL_FROM</span> to send for real.
          </p>
        )}

        <section className="mt-10 rounded-2xl border hairline bg-ink-900/40 px-6 py-6">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">
            Draft a mandate enquiry
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-400">
            Anonymous by construction: a facility band, a region and a term. No address, no price,
            nothing about the seller. Those only follow if the recipient says they are interested and
            the deal owner consents to disclosure.
          </p>
          <DraftForm
            candidates={approved.map((c) => ({ id: c.candidate.id, name: c.candidate.organisationName }))}
            deals={deals.map((d) => ({ id: d.id, reference: d.reference }))}
          />
        </section>

        <section className="mt-6 rounded-2xl border hairline bg-ink-900/40 px-6 py-6">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">
            Suppression list · {suppressions.length}
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-400">
            Checked immediately before every send, by address rather than by organisation. A
            &ldquo;remove me&rdquo; reply adds an address here automatically, without waiting for
            anybody.
          </p>
          <SuppressForm />
          {suppressions.length > 0 && (
            <ul className="mt-4 space-y-1">
              {suppressions.map((s) => (
                <li key={s.email} className="font-mono text-xs text-ink-500">
                  {s.email} — {s.reason}
                </li>
              ))}
            </ul>
          )}
        </section>

        {messages.length > 0 && (
          <ul className="mt-10 space-y-5">
            {messages.map((message) => (
              <li key={message.id} className="rounded-2xl border hairline bg-ink-900/40 px-6 py-6">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                  <p className="text-sm text-ink-100">{message.subject}</p>
                  <p className="font-mono text-xs">
                    <span className={STATUS_TONE[message.status] ?? "text-ink-400"}>
                      {message.status}
                    </span>
                    <span className="text-ink-600"> · </span>
                    <span className="text-ink-400">{message.to}</span>
                  </p>
                </div>

                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl border hairline bg-ink-950 px-4 py-3 text-xs leading-relaxed text-ink-300">
{message.body}
                </pre>

                <p className="mt-3 text-xs leading-relaxed text-ink-500">
                  {message.decision}: {message.decisionReason}
                </p>
                {message.failureReason !== undefined && (
                  <p className="mt-2 text-sm leading-relaxed text-red-300">{message.failureReason}</p>
                )}
                {message.approvedBy !== undefined && (
                  <p className="mt-2 font-mono text-[11px] text-ink-600">
                    Approved by {message.approvedBy}
                    {message.sentAt !== undefined ? ` · sent ${message.sentAt.slice(0, 10)}` : ""}
                  </p>
                )}
                {message.replyClassification !== undefined && (
                  <p className="mt-2 text-sm text-lode-200">
                    Replied: {message.replyClassification}
                  </p>
                )}

                <MessageActions messageId={message.id} status={message.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

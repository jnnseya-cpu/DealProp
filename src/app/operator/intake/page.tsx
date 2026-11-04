import Link from "next/link";
import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader, Panel, Badge } from "@/app/components/chrome";
import { requirePermission } from "@/app/operator/guard";
import { listIntakeConversations } from "@backend/store/repository";
import {
  reviewReasonLabel,
  type IntakeConversation,
  type IntakeConversationStatus,
} from "@shared/domain/intakeConversation";

export const dynamic = "force-dynamic";

export const metadata = { title: "Seller intake — Lode" };

/**
 * The intake review queue (spec §12).
 *
 * The automated assistant answers the safe, factual turns itself; everything
 * else — a distressed seller, an unclear authority, a prohibited claim, or
 * simply no model configured — lands here for a person. A conversation marked
 * `needs-review` is one the assistant deliberately did not answer, which is the
 * whole point: the machine never has the last word on a seller who needs one.
 */

const STATUS: Record<IntakeConversationStatus, { label: string; tone: "warn" | "neutral" | "good" }> = {
  "needs-review": { label: "Needs review", tone: "warn" },
  "awaiting-seller": { label: "Awaiting seller", tone: "neutral" },
  closed: { label: "Closed", tone: "good" },
};

function lastText(conversation: IntakeConversation): string {
  const last = conversation.messages[conversation.messages.length - 1];
  if (last === undefined) return "";
  const text = last.text.replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function Row({ conversation }: { conversation: IntakeConversation }) {
  const status = STATUS[conversation.status];
  const reasons = conversation.lastReview?.reviewReasonCodes ?? [];
  return (
    <li className="flex flex-col gap-1.5 px-5 py-3.5">
      <div className="flex items-center justify-between gap-4">
        <Link
          href={`/operator/intake/${conversation.id}`}
          className="font-mono text-[13px] text-ink-200 underline-offset-2 hover:text-ink-100 hover:underline"
        >
          {conversation.id.slice(0, 8)}
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-600 tabular-nums">
            {new Date(conversation.updatedAt).toLocaleString("en-GB")}
          </span>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </div>
      <p className="text-sm text-ink-400">{lastText(conversation)}</p>
      {conversation.status === "needs-review" && reasons.length > 0 && (
        <p className="text-xs leading-relaxed text-amber-300/90">
          {reasons.map((c) => reviewReasonLabel(c)).join(" ")}
        </p>
      )}
    </li>
  );
}

export default async function IntakeQueuePage() {
  await requirePermission("view-seller-data", "/operator/intake");
  const conversations = await listIntakeConversations();

  const needsReview = conversations.filter((c) => c.status === "needs-review");
  const awaiting = conversations.filter((c) => c.status === "awaiting-seller");
  const closed = conversations.filter((c) => c.status === "closed");

  return (
    <main className="min-h-screen">
      <SiteHeader width="max-w-5xl" />
      <div className="mx-auto max-w-5xl px-6 pt-6">
        <OperatorNav current="/operator/intake" />
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <span className="eyebrow">Intake</span>
        <h1 className="mt-2 font-display text-[24px] leading-tight text-ink-100">
          Seller enquiries
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-500">
          The assistant handles routine, factual questions. Anything it was not confident to
          answer — or anything flagged as sensitive — waits here for a person. Replies and
          closures are recorded against your account.
        </p>

        {conversations.length === 0 ? (
          <p className="mt-8 rounded-xl border hairline bg-surface-1 px-5 py-8 text-center text-sm text-ink-500">
            No seller conversations yet.
          </p>
        ) : (
          <div className="mt-8 space-y-6">
            <Panel
              title="Needs a person"
              eyebrow={`${needsReview.length} waiting`}
              flush
            >
              {needsReview.length === 0 ? (
                <p className="px-5 py-6 text-sm text-ink-500">Nothing waiting for review.</p>
              ) : (
                <ul className="divide-y hairline">
                  {needsReview.map((c) => (
                    <Row key={c.id} conversation={c} />
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Awaiting the seller" eyebrow={`${awaiting.length}`} flush>
              {awaiting.length === 0 ? (
                <p className="px-5 py-6 text-sm text-ink-500">None.</p>
              ) : (
                <ul className="divide-y hairline">
                  {awaiting.map((c) => (
                    <Row key={c.id} conversation={c} />
                  ))}
                </ul>
              )}
            </Panel>

            {closed.length > 0 && (
              <Panel title="Closed" eyebrow={`${closed.length}`} flush>
                <ul className="divide-y hairline">
                  {closed.map((c) => (
                    <Row key={c.id} conversation={c} />
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

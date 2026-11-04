import { notFound } from "next/navigation";
import Link from "next/link";
import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader, Panel, Button, Badge } from "@/app/components/chrome";
import { requirePermission } from "@/app/operator/guard";
import { getIntakeConversation } from "@backend/store/repository";
import {
  reviewReasonLabel,
  type IntakeMessage,
} from "@shared/domain/intakeConversation";
import { replyToSeller, closeConversation } from "../actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Seller enquiry — Lode" };

const SPEAKER: Record<IntakeMessage["from"], string> = {
  seller: "Seller",
  assistant: "Assistant",
  operator: "Operator",
};

function Bubble({ message }: { message: IntakeMessage }) {
  const mine = message.from !== "seller";
  return (
    <li className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
      <span className="eyebrow">{SPEAKER[message.from]}</span>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-xl border hairline px-3.5 py-2.5 text-sm leading-relaxed ${
          mine ? "bg-surface-3 text-ink-100" : "bg-surface-2 text-ink-200"
        }`}
      >
        {message.text}
      </div>
    </li>
  );
}

export default async function IntakeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePermission("view-seller-data", `/operator/intake/${id}`);
  const conversation = await getIntakeConversation(id);
  if (conversation === undefined) notFound();

  const review = conversation.lastReview;
  const closed = conversation.status === "closed";

  return (
    <main className="min-h-screen">
      <SiteHeader width="max-w-3xl" />
      <div className="mx-auto max-w-3xl px-6 pt-6">
        <OperatorNav current="/operator/intake" />
      </div>

      <div className="mx-auto max-w-3xl px-6 py-8">
        <Link href="/operator/intake" className="text-xs text-ink-500 hover:text-ink-300">
          ← Back to the queue
        </Link>
        <div className="mt-3 flex items-center justify-between gap-4">
          <div>
            <span className="eyebrow">Seller enquiry</span>
            <h1 className="mt-1 font-mono text-[15px] text-ink-100">{conversation.id}</h1>
          </div>
          {conversation.handledBy !== undefined && (
            <span className="text-xs text-ink-500">
              Last handled by {conversation.handledBy}
            </span>
          )}
        </div>

        <div className="mt-6 space-y-5">
          {review !== undefined && conversation.status === "needs-review" && (
            <Panel title="Why this needs a person" eyebrow="Review">
              <ul className="space-y-1.5 text-sm text-ink-300">
                {review.reviewReasonCodes.length === 0 ? (
                  <li>The assistant produced no reply safe to send automatically.</li>
                ) : (
                  review.reviewReasonCodes.map((c) => <li key={c}>— {reviewReasonLabel(c)}</li>)
                )}
              </ul>
              <p className="mt-3 text-xs text-ink-600">
                Assistant run: {review.provider}/{review.model} ·{" "}
                {new Date(review.at).toLocaleString("en-GB")}
              </p>
            </Panel>
          )}

          <Panel title="Conversation">
            <ul className="space-y-4">
              {conversation.messages.map((m) => (
                <Bubble key={m.id} message={m} />
              ))}
            </ul>
          </Panel>

          {closed ? (
            <p className="flex items-center gap-2 border-l-2 border-ink-600 pl-3 text-sm text-ink-400">
              <Badge tone="good">Closed</Badge>
              This conversation is closed.
            </p>
          ) : (
            <Panel title="Reply as Lode">
              <form action={replyToSeller} className="space-y-3">
                <input type="hidden" name="id" value={conversation.id} />
                <textarea
                  name="message"
                  required
                  rows={4}
                  maxLength={4000}
                  placeholder="Write to the seller in your own words. No offer or price unless one has been properly established."
                  className="w-full rounded-md border hairline bg-surface-2 px-3 py-2.5 text-sm text-ink-100 placeholder:text-ink-600 focus:border-ink-500 focus:outline-none"
                />
                <div className="flex justify-end">
                  <Button type="submit" variant="primary">
                    Send reply
                  </Button>
                </div>
              </form>
              <form action={closeConversation} className="mt-4 border-t hairline pt-4">
                <input type="hidden" name="id" value={conversation.id} />
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs text-ink-500">
                    Close once a call is booked or this has become a deal.
                  </p>
                  <Button type="submit" variant="secondary" size="sm">
                    Close conversation
                  </Button>
                </div>
              </form>
            </Panel>
          )}
        </div>
      </div>
    </main>
  );
}

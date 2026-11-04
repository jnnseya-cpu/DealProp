import { notFound } from "next/navigation";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader, Panel, Button } from "@/app/components/chrome";
import { getIntakeConversation } from "@backend/store/repository";
import type { IntakeMessage } from "@shared/domain/intakeConversation";
import { replyChat } from "../actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your enquiry — Lode",
  description: "Your conversation with Lode.",
};

const SPEAKER: Record<IntakeMessage["from"], { label: string; mine: boolean }> = {
  seller: { label: "You", mine: true },
  assistant: { label: "Lode assistant", mine: false },
  operator: { label: "Lode", mine: false },
};

function Bubble({ message }: { message: IntakeMessage }) {
  const who = SPEAKER[message.from];
  return (
    <li className={`flex flex-col gap-1 ${who.mine ? "items-end" : "items-start"}`}>
      <span className="eyebrow">{who.label}</span>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-xl border hairline px-3.5 py-2.5 text-sm leading-relaxed ${
          who.mine ? "bg-surface-3 text-ink-100" : "bg-surface-2 text-ink-200"
        }`}
      >
        {message.text}
      </div>
    </li>
  );
}

export default async function ChatThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ empty?: string }>;
}) {
  const { id } = await params;
  const { empty } = await searchParams;
  const conversation = await getIntakeConversation(id);
  if (conversation === undefined) notFound();

  const closed = conversation.status === "closed";
  const inReview = conversation.status === "needs-review";

  return (
    <main className="min-h-screen">
      <SiteHeader
        width="max-w-2xl"
        back="/sell/chat"
        trailing={<span className="text-xs text-ink-500">Automated assistant</span>}
      />

      <div className="mx-auto max-w-2xl px-6 pt-10">
        <span className="eyebrow">Your enquiry</span>
        <h1 className="mt-2.5 font-display text-[22px] leading-tight text-ink-100 sm:text-[26px]">
          Your conversation with Lode
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-500">
          Keep this page&apos;s link to return to your conversation. The assistant never makes
          an offer or quotes a price — those always come from a person.
        </p>

        <div className="mt-6 space-y-4">
          <Panel>
            <ul className="space-y-4">
              {conversation.messages.map((m) => (
                <Bubble key={m.id} message={m} />
              ))}
            </ul>
          </Panel>

          {inReview && (
            <p className="border-l-2 border-lode-500/60 pl-3 text-sm leading-relaxed text-ink-300">
              Thank you — a member of our team is reviewing your enquiry and will be in touch.
              You can add anything else below in the meantime.
            </p>
          )}

          {closed ? (
            <p className="border-l-2 border-ink-600 pl-3 text-sm leading-relaxed text-ink-400">
              This conversation is closed. If you need anything more,{" "}
              <a href="/sell/chat" className="text-ink-200 underline hover:text-ink-100">
                start a new enquiry
              </a>
              .
            </p>
          ) : (
            <Panel>
              <form action={replyChat} className="space-y-3">
                <input type="hidden" name="id" value={conversation.id} />
                <label htmlFor="message" className="block text-sm font-medium text-ink-200">
                  Your reply
                </label>
                <textarea
                  id="message"
                  name="message"
                  required
                  rows={4}
                  maxLength={4000}
                  className="w-full rounded-md border hairline bg-surface-2 px-3 py-2.5 text-sm text-ink-100 placeholder:text-ink-600 focus:border-ink-500 focus:outline-none"
                />
                {empty !== undefined && (
                  <p className="text-sm text-amber-300">Please write a short message before sending.</p>
                )}
                <div className="flex justify-end">
                  <Button type="submit" variant="primary">
                    Send
                  </Button>
                </div>
              </form>
            </Panel>
          )}
        </div>
      </div>

      <SiteFooter width="max-w-2xl" />
    </main>
  );
}

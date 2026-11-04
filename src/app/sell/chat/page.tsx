import Link from "next/link";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SiteHeader, Panel, Button } from "@/app/components/chrome";
import { startChat } from "./actions";

export const metadata = {
  title: "Ask Lode — Sell",
  description: "Tell us about your property in your own words. No account, no obligation.",
};

export default async function ChatStartPage({
  searchParams,
}: {
  searchParams: Promise<{ empty?: string }>;
}) {
  const { empty } = await searchParams;

  return (
    <main className="min-h-screen">
      <SiteHeader
        width="max-w-2xl"
        trailing={<span className="text-xs text-ink-500">No account. No obligation.</span>}
      />

      <div className="mx-auto max-w-2xl px-6 pt-14">
        <span className="eyebrow">Ask Lode</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          Tell us about your property.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-400">
          Write in your own words — your situation, the property, what you&apos;re hoping to
          do. Our assistant will ask a few follow-up questions. It is an automated assistant,
          not a person, and it never makes an offer or quotes a price: those always come from
          a member of our team. If anything about your enquiry needs a person, we&apos;ll pass
          it straight to one.
        </p>
        {empty !== undefined && (
          <p className="mt-4 border-l-2 border-amber-500/60 pl-3 text-sm text-amber-300">
            Please write a short message before sending.
          </p>
        )}

        <div className="mt-8">
          <Panel>
            <form action={startChat} className="space-y-4">
              <label htmlFor="message" className="block text-sm font-medium text-ink-200">
                Your message
              </label>
              <textarea
                id="message"
                name="message"
                required
                rows={6}
                maxLength={4000}
                placeholder="e.g. I've inherited a house in Leeds that needs a lot of work and I'd rather not go through an estate agent…"
                className="w-full rounded-md border hairline bg-surface-2 px-3 py-2.5 text-sm text-ink-100 placeholder:text-ink-600 focus:border-ink-500 focus:outline-none"
              />
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs text-ink-500">
                  Prefer a form?{" "}
                  <Link href="/sell" className="text-ink-300 underline hover:text-ink-100">
                    Use the step-by-step version
                  </Link>
                  .
                </p>
                <Button type="submit" variant="primary">
                  Start the conversation
                </Button>
              </div>
            </form>
          </Panel>
        </div>
      </div>

      <SiteFooter width="max-w-2xl" />
    </main>
  );
}

import { SiteHeader } from "@/app/components/chrome";
import { FEATURES } from "@shared/domain/newsletter";
import { SubscribeForm } from "./SubscribeForm";

export const metadata = {
  title: "Weekly email — Lode",
  description:
    "One email a week: what the platform does, what is in the pipeline, and what the engine rejected.",
};

export default function NewsletterPage() {
  return (
    <main className="min-h-screen">
      <SiteHeader
        width="max-w-3xl"
        trailing={<span className="text-xs text-ink-500">One email a week</span>}
      />

      <div className="mx-auto max-w-3xl px-6 py-10">
        <span className="eyebrow">
          Weekly email
        </span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          What the engine found this week.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-400">
          One email, every Monday. What is in the pipeline, what scored well after tax, and what the
          engine rejected and why. No drip sequence, no partner offers, no selling your address.
        </p>

        <div className="mt-10 rounded-2xl border hairline bg-surface-1 px-5 py-4">
          <SubscribeForm />
        </div>

        <section className="mt-14">
          <p className="eyebrow">
            What gets covered
          </p>
          <ul className="mt-4 space-y-4">
            {FEATURES.slice(0, 5).map((f) => (
              <li key={f.title}>
                <p className="text-sm text-ink-100">{f.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-400">{f.blurb}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12 rounded-2xl border hairline bg-surface-1 px-5 py-4">
          <p className="eyebrow">
            How we handle your address
          </p>
          <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-ink-300">
            <li>
              You are not subscribed until you click the link we email you. Nothing is sent before
              that.
            </li>
            <li>Every email carries a one-click unsubscribe. No sign-in, no questions asked.</li>
            <li>
              We never add sellers who fill in the enquiry form. Telling us about a property is not
              consent to be marketed at.
            </li>
            <li>Your address is not sold, shared or passed to buyers, funders or partners.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}

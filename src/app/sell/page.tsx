import { SellForm } from "./SellForm";
import { SiteHeader } from "@/app/components/chrome";

export const metadata = {
  title: "Sell — Lode",
  description: "Tell us your property problem. See the routes that actually solve it.",
};

export default function SellPage() {
  return (
    <main className="min-h-screen">
      <SiteHeader
        width="max-w-3xl"
        trailing={<span className="text-xs text-ink-500">Free for sellers. No obligation.</span>}
      />

      <div className="mx-auto max-w-3xl px-6 pt-14">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-lode-400">Sell</span>
        <h1 className="mt-4 font-display text-4xl leading-tight text-ink-100 sm:text-5xl">
          Tell us the problem.
          <br />
          We&apos;ll show you the routes.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-400">
          Five short steps. We ask about your situation before we ask about money, because the
          situation is what determines which options exist. Nothing here is an offer, and you can
          stop at any point.
        </p>
      </div>

      <SellForm />
    </main>
  );
}

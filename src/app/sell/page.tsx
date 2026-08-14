import Link from "next/link";
import { SellForm } from "./SellForm";

export const metadata = {
  title: "Sell — Lode",
  description: "Tell us your property problem. See the routes that actually solve it.",
};

export default function SellPage() {
  return (
    <main className="min-h-screen">
      <header className="border-b hairline">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-3">
            <svg width="22" height="22" viewBox="0 0 26 26" fill="none" aria-hidden>
              <path d="M13 2 3 8v10l10 6 10-6V8L13 2Z" stroke="var(--color-lode-400)" strokeWidth="1.3" />
              <path d="M8 11.5 13 8.5l5 3v5.5l-5 3-5-3v-5.5Z" fill="var(--color-lode-400)" fillOpacity="0.22" />
            </svg>
            <span className="font-display text-lg text-ink-100">Lode</span>
          </Link>
          <span className="text-xs text-ink-500">Free for sellers. No obligation.</span>
        </div>
      </header>

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

import { SellForm } from "./SellForm";
import { SiteHeader } from "@/app/components/chrome";
import { sellerFeeHeadline } from "@shared/domain/pricing";

export const metadata = {
  title: "Sell — Lode",
  description: "Tell us your property problem. See the routes that actually solve it.",
};

export default function SellPage() {
  return (
    <main className="min-h-screen">
      <SiteHeader
        width="max-w-3xl"
        trailing={<span className="text-xs text-ink-500">Free to see. No obligation.</span>}
      />

      <div className="mx-auto max-w-3xl px-6 pt-14">
        <span className="eyebrow">Sell</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          Tell us the problem.
          <br />
          We&apos;ll show you the routes.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-400">
          Five short steps. We ask about your situation before we ask about money, because the
          situation is what determines which options exist. Nothing here is an offer, and you can
          stop at any point.
        </p>
        <p className="mt-4 max-w-xl border-l-2 border-lode-400/70 py-1 pl-4 text-[13px] leading-[1.65] text-ink-400">
          Seeing your options costs nothing. If you go on to sell through us the fee is{" "}
          {sellerFeeHeadline()}, payable on completion — so if the property does not sell, you pay
          us nothing at all.
        </p>
      </div>

      <SellForm />
    </main>
  );
}

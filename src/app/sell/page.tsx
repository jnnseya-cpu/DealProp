import { SiteFooter } from "@/app/components/SiteFooter";
import { SellForm } from "./SellForm";
import { SiteHeader } from "@/app/components/chrome";
import { sellerFeeStatement } from "@shared/domain/fees";
import { permissionsHeld } from "@backend/permissions";

/*
 * Not indefinitely static.
 *
 * The footer prints the Companies Act 2006 s.82 disclosure, and it reads it
 * from the environment at render time. A page prerendered once at build has
 * that environment baked into it — and the Dockerfile deliberately passes only
 * NEXT_PUBLIC_* as build arguments, so at build there is no company identity to
 * read. A page with no revalidate would therefore serve "identity has not been
 * configured" for the life of the deployment, on the pages a seller actually
 * lands on. An hour is the window after a deploy, not a permanent state.
 */
export const revalidate = 3600;

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
          {sellerFeeStatement(permissionsHeld()).statement}
        </p>
      </div>

      <SellForm />
      <SiteFooter />
    </main>
  );
}

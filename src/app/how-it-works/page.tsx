import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/app/components/chrome";
import { SiteFooter } from "@/app/components/SiteFooter";
import { CoverageMap } from "@/app/components/CoverageMap";
import { siteUrl, SITE_NAME } from "@backend/site";
import { canonical } from "@shared/domain/blog";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: `How ${SITE_NAME} works`,
  description:
    "Tell us the problem, see the routes that solve it, and a named person takes it from there. How Lode works for sellers, buyers, funders and professionals.",
  alternates: { canonical: canonical(siteUrl(), "/how-it-works") },
};

interface Step {
  readonly n: string;
  readonly title: string;
  readonly body: string;
}

function Steps({ steps }: { steps: readonly Step[] }) {
  return (
    <ol className="mt-6 grid gap-1 overflow-hidden rounded-2xl border hairline bg-hairline sm:grid-cols-2">
      {steps.map((step) => (
        <li key={step.n} className="min-w-0 bg-surface-1 px-6 py-5">
          <span className="font-mono text-[11px] tracking-wider text-lode-400">{step.n}</span>
          <h3 className="mt-2.5 font-display text-lg leading-snug text-ink-100">{step.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-400">{step.body}</p>
        </li>
      ))}
    </ol>
  );
}

const SELLER: readonly Step[] = [
  { n: "01", title: "Tell us the problem", body: "Five short steps, and we ask about your situation before we ask about money, because the situation decides which routes exist. You can stop at any point, and nothing you see is an offer." },
  { n: "02", title: "See the routes", body: "The engine computes every route that genuinely solves it — what each pays you, when, and what you give up to get it. It will also show you what a buyer would make, because an offer below market value always ships with what you are giving up for it." },
  { n: "03", title: "A named person helps", body: "If a route works for you, a named person takes it forward. Before anyone is approached on your behalf, we check who an interested buyer is and that they are funded." },
  { n: "04", title: "Complete — or walk away", body: "You are free to take the options to the open market instead. If we act on a sale, you pay a single fee — a percentage of the price achieved, on completion and at no other point, only with your signed agreement." },
];

const BUYER: readonly Step[] = [
  { n: "01", title: "Set a Buy Box", body: "Tell us the shape of deal you want — area, type, strategy, the numbers that matter. It is a standing mandate, not a one-off search." },
  { n: "02", title: "Prove you are ready", body: "A readiness passport records your identity and funding. Nobody reaches a seller before this is checked — knowing exactly who a buyer is and nothing else is the refusal that matters." },
  { n: "03", title: "See matched opportunities", body: "The marketplace shows opportunities that fit, as a closed card — no address, no seller situation, no return figure — until the point a reveal is earned and paid for." },
];

const FUNDER: readonly Step[] = [
  { n: "01", title: "Publish a Funding Box", body: "Your lending criteria as a standing mandate: the facilities you write, the ratios you need, the regions you cover." },
  { n: "02", title: "See fundable deals", body: "Deals are scored on the ratios a funder actually decides on — LTV, LTGDV, funding gap, exit headroom — and packaged with the readiness a credit team expects." },
  { n: "03", title: "A lawful introduction", body: "An introduction is made only where the regulatory route permits it and the deal owner has consented to identify the transaction. Each stage of disclosure is gated separately." },
];

export default function HowItWorksPage() {
  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        width="max-w-4xl"
        trailing={
          <Link href="/about" className="text-xs text-ink-500 transition-colors hover:text-ink-100">
            About
          </Link>
        }
      />

      <div className="mx-auto max-w-4xl px-6 pt-14">
        <span className="eyebrow">How it works</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[34px] sm:leading-[1.1]">
          Bring the problem.
          <br />
          See the routes that solve it.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-300">
          Lode is one engine with four doors into it — a seller, a buyer, a funder, a professional.
          Whichever you are, the same thing is true underneath: one run returns one position, every
          figure carries its reasoning, and a named person decides anything that affects a real person.
        </p>

        <section className="mt-14">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-display text-2xl text-ink-100">If you have a property to sell</h2>
            <Link href="/sell" className="text-sm text-lode-300 underline underline-offset-2 hover:text-lode-200">
              Start
            </Link>
          </div>
          <Steps steps={SELLER} />
        </section>

        <section className="mt-14">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-display text-2xl text-ink-100">If you are buying or investing</h2>
            <Link href="/invest" className="text-sm text-lode-300 underline underline-offset-2 hover:text-lode-200">
              Buy Boxes
            </Link>
          </div>
          <Steps steps={BUYER} />
        </section>

        <section className="mt-14">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-display text-2xl text-ink-100">If you fund deals</h2>
            <Link href="/capital" className="text-sm text-lode-300 underline underline-offset-2 hover:text-lode-200">
              Funding Boxes
            </Link>
          </div>
          <Steps steps={FUNDER} />
        </section>

        <section className="mt-16 rounded-2xl border hairline bg-surface-1 px-6 py-6">
          <h2 className="font-display text-xl text-ink-100">Underneath all four: the engine</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-400">
            Every door runs the same engine. It is deterministic — the only place a model speaks is at
            the edges, proposing a value a named person decides on. It grades a deal only on what can
            be proved, it runs Seller Protection first and a block stops everything, and it refuses to
            show a figure it cannot stand behind. The result is a position the score, the memorandum
            and the seller&rsquo;s options cannot contradict, because they are the same answer.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/sell"
              className="inline-flex h-10 items-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300"
            >
              See your options — free
            </Link>
            <Link
              href="/partners"
              className="inline-flex h-10 items-center rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-100 transition-colors hover:border-ink-600 hover:bg-surface-3"
            >
              Agents &amp; professionals
            </Link>
          </div>
        </section>

        <CoverageMap />
      </div>

      <SiteFooter width="max-w-4xl" />
    </main>
  );
}

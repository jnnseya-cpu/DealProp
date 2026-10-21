import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/app/components/chrome";
import { SiteFooter } from "@/app/components/SiteFooter";
import { siteUrl, SITE_NAME } from "@backend/site";
import { canonical } from "@shared/domain/blog";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: `About ${SITE_NAME}`,
  description:
    "Lode is a Property Deal OS. It treats a property as a problem to solve, computes every lawful route that solves it, and keeps a named person on every decision.",
  alternates: { canonical: canonical(siteUrl(), "/about") },
};

function Principle({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-lode-400/70 pl-5">
      <h3 className="font-display text-lg text-ink-100">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-400">{children}</p>
    </div>
  );
}

export default function AboutPage() {
  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        width="max-w-3xl"
        trailing={
          <Link href="/how-it-works" className="text-xs text-ink-500 transition-colors hover:text-ink-100">
            How it works
          </Link>
        }
      />

      <div className="mx-auto max-w-3xl px-6 pt-14">
        <span className="eyebrow">About</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[34px] sm:leading-[1.1]">
          A property is a problem.
          <br />
          We compute the solution.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-300">
          A portal opens with &ldquo;how much is your property worth?&rdquo; — a number, before anyone
          has asked what you actually need. Lode opens with the problem: a probate you did not plan
          for, a chain that collapsed, a property that will not sell as it stands. The situation is
          what decides which routes exist, and the price is a consequence of the route, not the
          starting point.
        </p>

        <div className="mt-10 space-y-4 text-sm leading-relaxed text-ink-300">
          <p>
            A lode is a vein of ore running through rock. The work is assay: testing what is actually
            there rather than what the seam looks like from the surface. That is the whole product in
            one word. Lode takes a property and the circumstances around it, runs it through the same
            checks a careful buyer, a lender and a solicitor would each run, and returns one honest
            position — the routes that genuinely work, what each pays and when, and what you give up
            to get it.
          </p>
          <p>
            It is not a portal, and it is not an estate agent with a search box bolted on. It is an
            engine. One run returns one position, and the score, the memorandum and the options a
            seller is shown are the same answer rendered three ways, so they cannot quietly disagree.
          </p>
        </div>

        <h2 className="mt-14 font-display text-2xl text-ink-100">What makes it different</h2>
        <div className="mt-6 space-y-7">
          <Principle title="It is built to say no">
            Most tools in this market exist to make a deal look good. Ours runs the checks that decide
            whether it is real. Seller Protection can cap a score and force a rejection; a red team
            stresses every deal against the losses that sink them; and a figure computed from data
            nobody can stand behind is not shown at all.
          </Principle>
          <Principle title="It finds, it does not harass">
            We find motivated sellers from public records published under open licences — a property
            prepared for sale that never sold, a deceased estate, an owner in insolvency — not by
            scraping portals or harvesting profiles. And finding is where the automation stops: a
            named person decides every approach, individuals are written to by post, and nobody is
            contacted on autopilot.
          </Principle>
          <Principle title="Compliance is the architecture">
            The rules that govern this market are not a policy page here, they are structural. Money
            is integer pence behind a type so a rounding error cannot pass as a price. Data is not
            read without a recorded licence. The audit trail cannot be edited or deleted. A control
            that nothing calls is treated as no control at all.
          </Principle>
          <Principle title="Nothing here is an offer">
            Every figure is an estimate produced by an engine, not advice and not a valuation. Seeing
            your options is free, puts you under no obligation, and leaves you free to go to the open
            market instead. We would rather tell you a deal does not work than talk you into one that
            does not.
          </Principle>
        </div>

        <div className="mt-14 rounded-2xl border hairline bg-surface-1 px-6 py-6">
          <p className="text-sm leading-relaxed text-ink-300">
            If you have a property and a problem, the fastest way to understand Lode is to use it.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/sell"
              className="inline-flex h-10 items-center rounded-md bg-lode-400 px-4 text-sm font-medium text-ink-950 transition-colors hover:bg-lode-300"
            >
              See your options — free
            </Link>
            <Link
              href="/how-it-works"
              className="inline-flex h-10 items-center rounded-md border hairline bg-surface-2 px-4 text-sm text-ink-100 transition-colors hover:border-ink-600 hover:bg-surface-3"
            >
              How it works
            </Link>
          </div>
        </div>
      </div>

      <SiteFooter width="max-w-3xl" />
    </main>
  );
}

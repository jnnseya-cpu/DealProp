import Link from "next/link";
import { Button, Panel, SiteHeader, Stat } from "@/app/components/chrome";
import { SiteFooter } from "@/app/components/SiteFooter";
import { listBuyBoxes, listFundingBoxes } from "@backend/store/repository";
import { companyIdentity, identityGaps } from "@shared/domain/identity";
import { operatorPermissions } from "@backend/permissions";
import { disclosureFor, TRADE_PARTNERS } from "@shared/domain/partners";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Agents, professionals and capital — Lode",
  description:
    "Refer an instruction you cannot close and keep a fee. Set a funding mandate and see only deals inside it. What we are supervised for, and what we are not.",
};

/**
 * The page for everyone who is neither selling nor buying.
 *
 * Three audiences with almost nothing in common except that the landing page
 * served none of them. An estate agent read a headline telling their client not
 * to list and an engine section auditing why their listings failed. A funder
 * read "bring the deal, not necessarily the deposit" — which to a lender is a
 * description of a borrower with no skin in the game. A solicitor or a surveyor
 * read nothing at all.
 *
 * Each gets what they actually decide on: the agent gets money and a promise
 * about their client, the funder gets security and governance, the professional
 * gets volume.
 */
export default async function PartnersPage() {
  const [buyBoxes, fundingBoxes] = await Promise.all([listBuyBoxes(), listFundingBoxes()]);
  const identity = companyIdentity(process.env);
  const permissions = operatorPermissions();
  const outstanding = identityGaps(identity);

  return (
    <main className="min-h-screen">
      <SiteHeader
        width="max-w-5xl"
        trailing={
          <nav className="flex items-center gap-5 text-[13px] text-ink-400">
            <Link href="/appraise" className="transition-colors hover:text-ink-100">Appraisal</Link>
            <Link href="/sell" className="transition-colors hover:text-ink-100">Selling</Link>
            <Button href="/operator" size="sm">Sign in</Button>
          </nav>
        }
      />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <p className="eyebrow">Agents, professionals and capital</p>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[34px] sm:leading-[1.12]">
          The instructions you cannot close are the ones we want.
        </h1>
        <p className="mt-4 max-w-[38rem] text-[15px] leading-[1.6] text-ink-300">
          We are not an estate agent and we do not take instructions. What we take is the property
          that has been on the market four hundred days through three reductions, where the client
          needs it dealt with rather than maximised.
        </p>

        {/* --- agents ---------------------------------------------------- */}
        <section id="agents" className="mt-12 scroll-mt-20">
          <h2 className="font-display text-[22px] leading-tight text-ink-100">
            If you are an estate agent
          </h2>

          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            <Panel eyebrow="What you keep" title="The client">
              <p className="text-[13px] leading-[1.65] text-ink-300">
                We do not market the property, we do not put a board up, and we do not approach your
                client again about anything else. If no route works, the enquiry comes back to you
                with the reasons written down — which is worth having on its own, because it is an
                appraisal you did not have to pay for.
              </p>
            </Panel>

            <Panel eyebrow="What you get" title="A disclosed fee">
              <p className="text-[13px] leading-[1.65] text-ink-300">
                A referral fee on completion, disclosed to the seller in writing before they decide
                anything. The disclosure is not optional and it is not ours to waive:{" "}
                {permissions.regulatedMortgageIntroductions || permissions.creditBroking
                  ? "it is a condition of the permissions we hold."
                  : "an undisclosed referral fee is a breach of the estate agency rules, and the revenue engine already refuses this income until the supervision behind it is recorded."}
              </p>
            </Panel>

            <Panel eyebrow="What it costs you" title="Nothing">
              <p className="text-[13px] leading-[1.65] text-ink-300">
                No fee, no subscription, no minimum volume and no exclusivity. If it turns out we
                pay your client less than you could get them, the engine says so to their face —
                every below-market route ships with the sentence that an agent would probably
                achieve more.
              </p>
            </Panel>
          </div>

          <div className="mt-5 rounded-lg border-l-2 border-lode-500/80 bg-surface-1 px-5 py-4">
            <p className="text-[13px] leading-[1.65] text-ink-300">
              <span className="text-ink-100">Before you refer anybody:</span> a referral is a
              disclosure about your client, so it needs their agreement first. Send them{" "}
              <Link href="/sell" className="text-lode-300 underline underline-offset-2">
                the seller form
              </Link>{" "}
              and tell them you referred it — they get their routes free, we get the enquiry with
              their consent, and nobody has to take your word for what we offered.
            </p>
          </div>
        </section>

        {/* --- capital ---------------------------------------------------- */}
        <section id="capital" className="mt-14 scroll-mt-20">
          <h2 className="font-display text-[22px] leading-tight text-ink-100">
            If you are lending or investing
          </h2>
          <p className="mt-3 max-w-[42rem] text-[14px] leading-[1.6] text-ink-400">
            One sentence on the landing page reads badly from where you sit: &ldquo;bring the deal,
            not necessarily the deposit&rdquo; describes a sponsor with no cash in, which is the
            profile you are most careful about. It is aimed at the sponsor, and it is not a
            statement about what you are asked to fund. Here is what is.
          </p>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Panel eyebrow="Your security" title="First charge, and the gap is evidenced">
              <p className="text-[13px] leading-[1.65] text-ink-300">
                A Funding Box records whether you require a first charge and a personal guarantee,
                and no deal reaches you that does not satisfy both. The sponsor&rsquo;s cash is
                counted only where it has been evidenced — unevidenced cash is treated as a funding
                gap, not as cash, because a gap that quietly assumes the sponsor will find the money
                is the assumption that fails at completion rather than at appraisal.
              </p>
            </Panel>

            <Panel eyebrow="What you are shown" title="The downside, first">
              <p className="text-[13px] leading-[1.65] text-ink-300">
                Every deal arrives with nine stress scenarios already run, the single-factor losses
                named, the true cost of the facility, and what actually arrives at drawdown after
                retained interest. A deal whose exit does not repay the debt is flagged as such
                rather than presented at its headline loan-to-value.
              </p>
            </Panel>

            <Panel eyebrow="Before an introduction" title="The perimeter is classified">
              <p className="text-[13px] leading-[1.65] text-ink-300">
                Every transaction is routed before anything is sent: a loan secured on a dwelling
                the borrower occupies is regulated whatever purpose was declared, and an
                unclassified transaction routes to review rather than to permitted. Where we do not
                hold the permission an introduction needs, the introduction is refused — not
                disclosed and made anyway.
              </p>
            </Panel>

            <Panel eyebrow="Accountability" title="Who decided, and when">
              <p className="text-[13px] leading-[1.65] text-ink-300">
                Every decision on a deal is recorded against a named person with their reason, in an
                append-only trail the database itself will not let anybody edit. The automated
                agents cannot bind a party, accept terms, waive a condition or move funds — not as
                policy, but because there is no code path that does it.
              </p>
            </Panel>
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-3">
            <Panel eyebrow="Recorded now" title="Mandates">
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Funding boxes" value={String(fundingBoxes.length)} size="sm" />
                <Stat label="Buy boxes" value={String(buyBoxes.length)} size="sm" />
              </div>
              <p className="mt-3 text-[12px] leading-[1.6] text-ink-500">
                Live counts from the platform, not a marketing figure. If this reads low, it is low.
              </p>
            </Panel>

            <Panel eyebrow="Track record" title="None yet" className="sm:col-span-2">
              <p className="text-[13px] leading-[1.65] text-ink-300">
                No completed transaction has run through this platform, so there is no default
                history, no loss rate and no repayment record to show you. We would rather say that
                here than let you discover it in diligence. The engines, the controls and the audit
                trail are built and tested; the track record is the thing that can only be earned.
              </p>
            </Panel>
          </div>
        </section>

        {/* --- professionals ---------------------------------------------- */}
        <section id="professionals" className="mt-14 scroll-mt-20">
          <h2 className="font-display text-[22px] leading-tight text-ink-100">
            If you are a solicitor, surveyor, broker or contractor
          </h2>
          <p className="mt-3 max-w-[42rem] text-[14px] leading-[1.6] text-ink-400">
            Every transaction here needs conveyancing, a valuation, finance and usually works. We
            introduce those, and the introduction always carries the interest behind it — a
            recommendation that hides who is paid for it is worth nothing to the person receiving
            it.
          </p>

          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {TRADE_PARTNERS.map((partner) => (
              <li key={partner.key} className="rounded-xl border hairline bg-surface-1 px-5 py-4">
                <p className="font-display text-[17px] leading-tight text-ink-100">{partner.name}</p>
                <p className="mt-1 text-[13px] text-lode-300">{partner.remit}</p>
                {/* The disclosure comes from the referral engine, never from
                    this page — a surface must not be able to show an
                    introduction without the interest behind it. */}
                <p className="mt-2.5 border-t hairline pt-2.5 text-[12px] leading-[1.6] text-ink-500">
                  {disclosureFor(partner)}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* --- what we are not -------------------------------------------- */}
        <section className="mt-14">
          <h2 className="font-display text-[22px] leading-tight text-ink-100">
            What we are not supervised for
          </h2>
          <p className="mt-3 max-w-[42rem] text-[14px] leading-[1.6] text-ink-400">
            Stated here rather than left to be discovered, because every one of these limits what we
            may lawfully do with you.
          </p>

          <ul className="mt-4 space-y-2.5">
            {outstanding.map((gap) => (
              <li key={gap.key} className="flex gap-3 text-[13px] leading-[1.6] text-ink-400">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                <span>
                  <span className="text-ink-200">{gap.label}</span> — {gap.consequence}
                </span>
              </li>
            ))}
            {outstanding.length === 0 && (
              <li className="text-[13px] leading-[1.6] text-emerald-300">
                Every registration and supervision is recorded and shown in the footer.
              </li>
            )}
          </ul>
        </section>

        <div className="mt-12 flex flex-wrap items-center gap-3 border-t hairline pt-8">
          <Button href="/sell" variant="primary">Send a seller to their options</Button>
          <Button href="/appraise">Appraise a deal</Button>
        </div>
      </div>

      <SiteFooter width="max-w-5xl" />
    </main>
  );
}

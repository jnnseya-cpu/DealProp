import { redirect } from "next/navigation";
import { OperatorNav } from "@/app/operator/OperatorNav";
import { AccountNav } from "@/app/account/AccountNav";
import { Badge, Button, Panel, SiteHeader } from "@/app/components/chrome";
import { currentViewer } from "@/app/operator/guard";
import { can, certificationStatus, ROLE_LABELS } from "@shared/domain/accounts";
import { listDealsForOwner } from "@backend/store/repository";
import type { DealStatus } from "@shared/domain/types";

export const dynamic = "force-dynamic";

export const metadata = { title: "Your account — Lode" };

/**
 * The account home — one command centre that assembles the signed-in person's
 * own surfaces, scoped to exactly what their role may see.
 *
 * This is the landing the account area never had: `/account` used to 404, so a
 * self-service customer had sub-pages but no home that tied them together. It
 * computes nothing of its own — it reads the account and routes to the surfaces
 * that already exist (mandates, readiness, listings, submissions, billing),
 * showing each only where `can()` allows. Every figure still comes from its own
 * engine on its own page; this is a map, not a model.
 */

const STATUS_TONE: Record<DealStatus, "neutral" | "accent" | "good" | "warn"> = {
  new: "accent",
  qualified: "accent",
  "in-market": "good",
  funded: "good",
  completed: "good",
  withdrawn: "neutral",
};

const STATUS_LABEL: Record<DealStatus, string> = {
  new: "Received",
  qualified: "Being assessed",
  "in-market": "On the market",
  funded: "Funded",
  completed: "Completed",
  withdrawn: "Withdrawn",
};

export default async function AccountHome() {
  const viewer = await currentViewer();
  if (viewer === undefined) redirect("/operator?next=%2Faccount");

  // The shared operator password is not a person; it has no personal home.
  // Point it at the cockpit it does belong to rather than an empty dashboard.
  if (viewer.kind !== "account") {
    return (
      <main className="min-h-screen">
        <SiteHeader trailing={<OperatorNav current="/account" />} />
        <div className="mx-auto max-w-2xl px-6 py-16">
          <span className="eyebrow">Account</span>
          <h1 className="mt-2 font-display text-[26px] leading-tight text-ink-100">
            No personal account here
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-ink-300">
            You are signed in with the shared operator password, which is not a named person. The
            cockpit is your home — a personal account dashboard belongs to a named account.
          </p>
          <div className="mt-6">
            <Button href="/operator/dashboard" variant="primary">
              Go to the operator cockpit →
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const account = viewer.account;
  const now = new Date();
  const isStaff = can(account, "view-seller-data").allowed;
  const isSeller = can(account, "manage-own-property").allowed;
  const isInvestorOrFunder = can(account, "manage-own-mandates").allowed;
  const isPartner = can(account, "import-own-listings").allowed;

  // Only the seller view reads deal rows, and only their own, scoped by owner.
  const myDeals = isSeller ? await listDealsForOwner(account.id) : [];
  const cert = isInvestorOrFunder ? certificationStatus(account, now) : undefined;
  const mandateHref = account.role === "funder" ? "/capital" : "/invest";
  const mandateLabel = account.role === "funder" ? "Funding Boxes" : "Buy Boxes";

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={isStaff ? <OperatorNav current="/account" /> : <AccountNav current="/account" />}
      />

      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="eyebrow">Your account</span>
          <Badge tone="accent">{ROLE_LABELS[account.role]}</Badge>
        </div>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          Welcome{account.name !== "" ? `, ${account.name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          Everything you can do on Lode, in one place. {account.email}
        </p>

        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {/* Staff account signed in on the account side: a pointer home. */}
          {isStaff && (
            <Panel eyebrow="Operator" title="The cockpit">
              <p className="text-[13px] leading-relaxed text-ink-300">
                Your account carries staff permissions. The pipeline, sourcing and billing live in
                the operator cockpit.
              </p>
              <div className="mt-4">
                <Button href="/operator/dashboard" variant="primary" size="sm">
                  Open the cockpit →
                </Button>
              </div>
            </Panel>
          )}

          {/* Seller: submit and track your own property. */}
          {isSeller && !isStaff && (
            <Panel eyebrow="Your property" title="Sell a property">
              <p className="text-[13px] leading-relaxed text-ink-300">
                A fair cash offer, direct. Selling to us is free — no agent, no commission, no fees.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button href="/sell" variant="primary" size="sm">
                  Submit a property →
                </Button>
                <Button href="/how-it-works" variant="ghost" size="sm">
                  How it works
                </Button>
              </div>

              {myDeals.length > 0 ? (
                <ul className="mt-5 space-y-2 border-t hairline pt-4">
                  {myDeals.map((deal) => (
                    <li key={deal.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                      <div className="min-w-0">
                        <p className="text-sm text-ink-100">
                          {deal.property.locality !== "" ? deal.property.locality : "Your property"}
                          {deal.property.postcodeArea !== "" ? ` · ${deal.property.postcodeArea}` : ""}
                        </p>
                        <p className="font-mono text-[10px] uppercase tracking-wider text-ink-600">
                          {deal.reference} · submitted {deal.createdAt.slice(0, 10)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={STATUS_TONE[deal.status]}>{STATUS_LABEL[deal.status]}</Badge>
                        <a
                          href={`/sell/${deal.id}`}
                          className="text-[13px] text-lode-300 underline-offset-2 hover:underline"
                        >
                          Options →
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-5 border-t hairline pt-4 text-[12px] leading-relaxed text-ink-500">
                  Nothing submitted yet. When you submit a property while signed in, it appears here
                  with its status and a link to your options.
                </p>
              )}
            </Panel>
          )}

          {/* Investor / funder: readiness, certification, and their mandates. */}
          {isInvestorOrFunder && (
            <Panel eyebrow="Deal material" title="Your certification">
              {cert !== undefined && (
                <>
                  <div className="flex items-center gap-2">
                    <Badge tone={cert.current ? "good" : "warn"}>
                      {cert.current ? "Certified" : "Not certified"}
                    </Badge>
                    {cert.expiresAt !== undefined && cert.current && (
                      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-600">
                        until {cert.expiresAt}
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-[13px] leading-relaxed text-ink-300">{cert.reason}</p>
                </>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button href="/account/certify" variant={cert?.current ? "ghost" : "primary"} size="sm">
                  {cert?.current ? "Review certification" : "Certify to see deal material →"}
                </Button>
                <Button href="/account/passport" variant="ghost" size="sm">
                  Readiness passport
                </Button>
              </div>
            </Panel>
          )}

          {isInvestorOrFunder && (
            <Panel eyebrow="Your book" title={mandateLabel}>
              <p className="text-[13px] leading-relaxed text-ink-300">
                Set what you&apos;re looking for and see matched opportunities, readiness-sorted.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button href={mandateHref} variant="primary" size="sm">
                  Open {mandateLabel} →
                </Button>
                <Button href="/opportunities" variant="ghost" size="sm">
                  Browse opportunities
                </Button>
              </div>
            </Panel>
          )}

          {/* Partner: their own listings. */}
          {isPartner && (
            <Panel eyebrow="Your stock" title="Listings">
              <p className="text-[13px] leading-relaxed text-ink-300">
                Import and manage your own listings, and refer instructions you can&apos;t complete.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button href="/account/listings" variant="primary" size="sm">
                  Your listings →
                </Button>
                <Button href="/partners" variant="ghost" size="sm">
                  Partner with Lode
                </Button>
              </div>
            </Panel>
          )}

          {/* Everyone with an account: the common surfaces. */}
          <Panel eyebrow="Account" title="Your details">
            <div className="flex flex-col gap-2">
              <Button href="/account/profile" variant="secondary" size="sm">
                Profile &amp; picture
              </Button>
              <Button href="/account/billing" variant="secondary" size="sm">
                Billing
              </Button>
              <Button href="/account/inbox" variant="secondary" size="sm">
                Inbox
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </main>
  );
}

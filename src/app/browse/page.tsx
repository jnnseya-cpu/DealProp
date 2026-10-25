import Link from "next/link";
import { Badge, Button, SiteHeader } from "@/app/components/chrome";
import { SiteFooter } from "@/app/components/SiteFooter";
import { getDealImage, pageDeals } from "@backend/store/repository";
import { appraise } from "@shared/domain/economics";
import { scoreDeal } from "@shared/domain/dealScore";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { materialInformation } from "@shared/domain/materialInformation";
import { sellerDueDiligence } from "@shared/domain/sellerDueDiligence";
import { gbp, titleCase } from "@shared/format";
import type { DealStatus } from "@shared/domain/types";

// Public, and cached: a window-shop surface a visitor reaches before any
// account. Re-rendered at most every five minutes however much traffic
// arrives, so the marketability checks below run a handful of times an hour.
export const revalidate = 300;

export const metadata = {
  title: "Properties — Lode",
  description:
    "Verified properties available through Lode. Each has been cleared to market; sign in to see the full detail and act.",
};

/** How many properties the public window shows. A window, not the whole stock. */
const WINDOW = 36;

/** Statuses a property a buyer could still act on is in. */
const OPEN: ReadonlySet<DealStatus> = new Set<DealStatus>(["new", "qualified", "in-market"]);

interface PublicCard {
  readonly id: string;
  readonly heading: string;
  readonly area: string;
  readonly tenure: string;
  readonly guidePrice: string;
  readonly verified: boolean;
  readonly photo?: string;
}

/**
 * The public property window.
 *
 * Deliberately not `/opportunities`, which is gated and shows deal material. A
 * visitor who is not signed in sees this: enough to know there is real stock
 * and to want in, and no more. Three rules decide what appears and what each
 * card carries, and they are the reason this can be public at all:
 *
 *  1. **Only a property that may lawfully be marketed appears.** Not blocked by
 *     Seller Protection, its Part A material information complete, its seller
 *     checked. A property that may not be marketed is not shown — showing one
 *     would be the misleading omission the CPRs are about.
 *  2. **No address, no seller situation, no return.** Locality and postcode
 *     district only (what an agent's window shows), a guide price, and nothing
 *     about yield or margin — a public statement of a return would be a
 *     financial promotion under FSMA s.21, which only an authorised person may
 *     communicate.
 *  3. **The photo is emitted by the server, inline.** Only for a property this
 *     page has already decided is marketable, so there is no public image URL
 *     that could serve a photo of one that is not.
 */
export default async function BrowsePage() {
  const now = new Date();
  const page = await pageDeals(WINDOW);

  const cards: PublicCard[] = [];
  for (const record of page.rows) {
    if (!OPEN.has(record.status)) continue;

    const inputs = toWorkingDeal(record.inputs).inputs;
    if (scoreDeal(inputs).protection.blocked) continue;

    const property = appraise(inputs).inputs.property;
    if (!materialInformation(property, record.material ?? {}).mayMarket) continue;
    if (!sellerDueDiligence(record.sellerChecks, now).mayGoToMarket) continue;

    // The first photo, inlined. Emitted only here, where the property has
    // already passed every marketing gate above.
    const image = await getDealImage(record.id, 0);

    cards.push({
      id: record.id,
      heading: `${property.bedrooms > 0 ? `${property.bedrooms}-bed ` : ""}${titleCase(
        property.propertyType.replace(/-/g, " "),
      )} · ${property.locality}`,
      area: property.postcodeArea,
      tenure: titleCase(property.tenure.replace(/-/g, " ")),
      guidePrice: gbp(property.openMarketValue),
      verified: record.inventory?.category === "owner-verified",
      ...(image !== undefined ? { photo: `data:${image.contentType};base64,${image.dataBase64}` } : {}),
    });
  }

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-5 text-[13px] text-ink-400">
            <Link href="/sell" className="transition-colors hover:text-ink-100">
              Sell a property
            </Link>
            <Link href="/operator" className="transition-colors hover:text-ink-100">
              Sign in
            </Link>
          </nav>
        }
      />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <p className="eyebrow">Properties</p>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {cards.length === 0 ? "No properties listed yet" : `${cards.length} available now`}
        </h1>
        <p className="mt-4 max-w-[42rem] text-[14px] leading-[1.6] text-ink-400">
          Every property here has been cleared to market — its material information recorded and its
          seller checked. The address and the full figures are shown once you sign in; a reveal is a
          named introduction to somebody who agreed to sell.
        </p>

        {cards.length === 0 ? (
          <div className="mt-10 rounded-xl border hairline bg-surface-1 px-5 py-6">
            <p className="text-sm leading-relaxed text-ink-300">
              Nothing is publicly listed at the moment. Properties appear here once they have been
              verified and cleared to market.
            </p>
            <p className="mt-3 text-sm text-ink-400">
              Have a property to sell?{" "}
              <Link href="/sell" className="text-lode-300 underline-offset-2 hover:underline">
                Tell us about it
              </Link>{" "}
              — it is free, and you see your options immediately.
            </p>
          </div>
        ) : (
          <div className="mt-9 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <Link
                key={card.id}
                href={`/opportunities/${encodeURIComponent(card.id)}`}
                className="group block overflow-hidden rounded-xl border hairline bg-surface-1 transition-colors hover:border-ink-600"
              >
                {card.photo !== undefined ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={card.photo} alt="" className="aspect-[3/2] w-full object-cover" />
                ) : (
                  <div className="flex aspect-[3/2] w-full items-center justify-center bg-surface-2 text-[12px] text-ink-600">
                    Photo on request
                  </div>
                )}
                <div className="px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-display text-[15px] leading-tight text-ink-100">
                      {card.heading}
                    </h2>
                    {card.verified && <Badge tone="good">Verified</Badge>}
                  </div>
                  <p className="mt-1 text-[12px] text-ink-500">
                    {card.area} · {card.tenure}
                  </p>
                  <p className="mt-2.5 tnum text-[15px] text-ink-200">{card.guidePrice}</p>
                  <p className="mt-0.5 text-[11px] text-ink-500">Guide price</p>
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-12 rounded-xl border hairline bg-surface-1 px-5 py-6 text-center">
          <p className="text-sm text-ink-200">Want the address, the figures and to act on one?</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <Button href="/operator" variant="primary" size="sm">
              Sign in to see detail
            </Button>
            <Button href="/sell" variant="secondary" size="sm">
              Sell a property
            </Button>
          </div>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}

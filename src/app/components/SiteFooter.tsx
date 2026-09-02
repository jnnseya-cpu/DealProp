import Link from "next/link";
import { companyIdentity, identityGaps, registrationLine } from "@shared/domain/identity";
import { Mark } from "@/app/components/chrome";

/**
 * The footer, and specifically the identity block in it.
 *
 * A visitor deciding whether to tell us about a bereavement, or to lend
 * against a deal, looks for the same thing first: evidence that a company
 * exists and can be found. This prints what has been recorded and nothing
 * else — no placeholder number, no invented address — because a false
 * statement of identity in this position is worse than a missing one.
 *
 * Where nothing has been recorded it says so plainly rather than rendering an
 * empty block. That is deliberate: it is visible in development, it is
 * embarrassing on purpose, and `npm run preflight` refuses to pass while it is
 * true, so it cannot reach production quietly.
 */
export function SiteFooter({ width = "max-w-7xl" }: { width?: string }) {
  const identity = companyIdentity(process.env);
  const registration = registrationLine(identity);
  const blocking = identityGaps(identity).filter((g) => g.blocking);

  return (
    <footer className="border-t hairline bg-surface-1">
      <div className={`mx-auto ${width} px-6 py-10`}>
        <div className="grid gap-8 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <Mark size={18} />
              <span className="font-display text-[16px] text-ink-100">
                {identity.tradingName ?? "Lode"}
              </span>
            </div>
            <p className="mt-3 max-w-xs text-[13px] leading-[1.6] text-ink-400">
              Problems become deals. Deals find capital. Capital closes property.
            </p>
          </div>

          <nav aria-label="Product" className="text-[13px]">
            <p className="eyebrow">Product</p>
            <ul className="mt-3 space-y-2">
              <FooterLink href="/appraise">Free appraisal</FooterLink>
              <FooterLink href="/sell">Selling a property</FooterLink>
              <FooterLink href="/partners">Agents and professionals</FooterLink>
              <FooterLink href="/blog">Writing</FooterLink>
              <FooterLink href="/newsletter">Newsletter</FooterLink>
            </ul>
          </nav>

          <div className="text-[13px]">
            <p className="eyebrow">Contact</p>
            <ul className="mt-3 space-y-2 text-ink-400">
              {identity.contactEmail !== undefined && (
                <li>
                  <a
                    href={`mailto:${identity.contactEmail}`}
                    className="transition-colors hover:text-ink-100"
                  >
                    {identity.contactEmail}
                  </a>
                </li>
              )}
              {identity.contactPhone !== undefined && (
                <li>
                  <a
                    href={`tel:${identity.contactPhone.replace(/\s/g, "")}`}
                    className="transition-colors hover:text-ink-100"
                  >
                    {identity.contactPhone}
                  </a>
                </li>
              )}
              {identity.registeredOffice !== undefined && (
                <li className="leading-[1.6]">{identity.registeredOffice}</li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-9 border-t hairline pt-6 text-[12px] leading-[1.7] text-ink-500">
          {registration !== undefined ? (
            <p>{registration}</p>
          ) : (
            <p className="text-amber-300">
              Company identity has not been configured. Set the company details in the environment —
              the registered name, number, place of registration and registered office are required
              on every page by the Companies Act 2006 s.82, and{" "}
              <code className="font-mono">npm run preflight</code> will not pass while this line is
              showing.
            </p>
          )}

          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            {identity.icoRegistration !== undefined && (
              <li>ICO registration {identity.icoRegistration}</li>
            )}
            {identity.amlSupervision !== undefined && (
              <li>HMRC anti-money-laundering supervision {identity.amlSupervision}</li>
            )}
            {identity.redressScheme !== undefined && <li>{identity.redressScheme}</li>}
          </ul>

          {blocking.length > 0 && registration !== undefined && (
            <p className="mt-2 text-amber-300">
              {blocking.length} statutory disclosure{blocking.length === 1 ? "" : "s"} still
              unrecorded: {blocking.map((g) => g.label.toLowerCase()).join(", ")}.
            </p>
          )}

          <p className="mt-4 max-w-3xl">
            Figures shown anywhere on this site are screening estimates produced by an engine, not
            advice, not a valuation and not an offer. Tax figures always require professional
            review. We are not an estate agent and we do not charge sellers.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="text-ink-400 transition-colors hover:text-ink-100">
        {children}
      </Link>
    </li>
  );
}

import Link from "next/link";
import { companyIdentity, identityGaps, registrationLine } from "@shared/domain/identity";
import { Mark } from "@/app/components/chrome";
import { InstallButton } from "@/app/components/InstallButton";
import { sellerFeeStatement } from "@shared/domain/fees";
import { permissionsHeld } from "@backend/permissions";
import { FOOTER_COMPANY, FOOTER_LEGAL, FOOTER_PRODUCT, type NavLink } from "@shared/domain/legal";

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
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
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
            <InstallButton />
          </div>

          <FooterColumn label="Product" links={FOOTER_PRODUCT} />
          <FooterColumn label="Company" links={FOOTER_COMPANY} />
          <FooterColumn label="Legal" links={FOOTER_LEGAL} />
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

          {(identity.contactEmail !== undefined ||
            identity.contactPhone !== undefined ||
            identity.registeredOffice !== undefined) && (
            <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {identity.contactEmail !== undefined && (
                <a href={`mailto:${identity.contactEmail}`} className="transition-colors hover:text-ink-200">
                  {identity.contactEmail}
                </a>
              )}
              {identity.contactPhone !== undefined && (
                <a
                  href={`tel:${identity.contactPhone.replace(/\s/g, "")}`}
                  className="transition-colors hover:text-ink-200"
                >
                  {identity.contactPhone}
                </a>
              )}
              {identity.registeredOffice !== undefined && <span>{identity.registeredOffice}</span>}
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

          {/*
            "We do not charge sellers" was printed here, on every page of a site
            whose seller journey quotes a percentage of the price achieved two
            screens above. Two typed sentences will eventually disagree and the
            false one is always the one on more pages. This asks the fee engine.
          */}
          <p className="mt-4 max-w-3xl">
            Figures shown anywhere on this site are screening estimates produced by an engine, not
            advice, not a valuation and not an offer. Tax figures always require professional
            review. {sellerFeeStatement(permissionsHeld(process.env.HELD_PERMISSIONS)).statement}
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ label, links }: { label: string; links: readonly NavLink[] }) {
  return (
    <nav aria-label={label} className="text-[13px]">
      <p className="eyebrow">{label}</p>
      <ul className="mt-3 space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-ink-400 transition-colors hover:text-ink-100">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

import Link from "next/link";
import { companyIdentity } from "@shared/domain/identity";
import { Mark } from "@/app/components/chrome";
import { InstallButton } from "@/app/components/InstallButton";
import { FooterIdentity } from "@/app/components/FooterIdentity";
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

        {/*
          The statutory identity and the fee statement are RUNTIME configuration
          and must never be baked at build (a statically prerendered page would
          show an empty identity as a false "not configured" warning). They are
          read from /api/identity in this client component instead, so every page
          — static, ISR or SSG — shows the live details without being forced
          dynamic.
        */}
        <FooterIdentity />
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

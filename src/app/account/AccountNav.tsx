import Link from "next/link";
import { SignOutButton } from "@/app/operator/SignOutButton";

/**
 * The navigation a normal account sees.
 *
 * Deliberately not the operator nav. A buyer or funder has an account, not a
 * back office — showing them Billing adjustments, Discovery, Payouts, the audit
 * trail and the prohibitions register would be both confusing and a disclosure
 * of how the operator side works. This is their own surface: opportunities,
 * their readiness, their money, their profile. Admins get the operator nav
 * instead, which is what makes the two areas look and feel different.
 */

interface Destination {
  readonly href: string;
  readonly label: string;
}

const DESTINATIONS: readonly Destination[] = [
  { href: "/opportunities", label: "Opportunities" },
  { href: "/account/passport", label: "Readiness" },
  { href: "/account/billing", label: "Billing" },
  { href: "/account/profile", label: "Profile" },
  { href: "/account/inbox", label: "Inbox" },
];

export function AccountNav({ current }: { current?: string }) {
  return (
    <nav
      aria-label="Account"
      className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 text-sm text-ink-400"
    >
      {DESTINATIONS.map((destination) => {
        const here = destination.href === current;
        return (
          <Link
            key={destination.href}
            href={destination.href}
            aria-current={here ? "page" : undefined}
            className={here ? "text-ink-100" : "transition-colors hover:text-ink-100"}
          >
            {destination.label}
          </Link>
        );
      })}
      <SignOutButton />
    </nav>
  );
}

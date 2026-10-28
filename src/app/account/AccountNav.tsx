import { NavBar, type NavItem } from "@/app/components/NavBar";

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

const DESTINATIONS: readonly NavItem[] = [
  { href: "/account", label: "Home" },
  { href: "/opportunities", label: "Opportunities" },
  { href: "/account/passport", label: "Readiness" },
  { href: "/account/billing", label: "Billing" },
  { href: "/account/profile", label: "Profile" },
  { href: "/account/inbox", label: "Inbox" },
];

export function AccountNav({ current }: { current?: string }) {
  return <NavBar items={DESTINATIONS} current={current} label="Account" />;
}

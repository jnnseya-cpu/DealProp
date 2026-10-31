import { NavBar, type NavItem } from "@/app/components/NavBar";

/**
 * The operator navigation, in one place.
 *
 * It was written out by hand on eight pages, each with a slightly different
 * subset of the links and its own idea of which hover class to use. Two
 * consequences, and the second is the one that mattered: an operator on
 * `/operator/discovery` could not reach `/operator/payouts` without typing the
 * URL, and the row was a non-wrapping flex that ran 33px past the right edge
 * of a phone — found by loading the page at 393px rather than by looking at it
 * on a laptop.
 *
 * `flex-wrap` is the fix for the overflow, and one component is the fix for
 * the drift. The current page is marked with `aria-current` rather than only a
 * colour, because "which page am I on" should not be a question only a sighted
 * user can answer.
 */

/**
 * Everything an operator can reach. Ordered by how often it is wanted rather
 * than alphabetically — the pipeline first, the registers last.
 */
const DESTINATIONS: readonly NavItem[] = [
  { href: "/operator/dashboard", label: "Overview" },
  { href: "/deals", label: "Deals" },
  { href: "/capital", label: "Capital" },
  { href: "/operator/billing", label: "Billing" },
  { href: "/operator/payouts", label: "Payouts" },
  { href: "/operator/discovery", label: "Discovery" },
  { href: "/operator/sourcing", label: "Sourcing" },
  { href: "/operator/import", label: "Import" },
  { href: "/operator/outreach", label: "Outreach" },
  { href: "/operator/accounts", label: "Accounts" },
  { href: "/operator/notifications", label: "Comms" },
  { href: "/operator/blog", label: "Blog" },
  { href: "/operator/audit", label: "Audit" },
  { href: "/operator/conduct", label: "Conduct" },
  { href: "/operator/permissions", label: "Permissions" },
  { href: "/operator/settings", label: "Config" },
];

export function OperatorNav({ current }: { current?: string }) {
  return <NavBar items={DESTINATIONS} current={current} label="Operator" />;
}

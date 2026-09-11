import Link from "next/link";
import { SignOutButton } from "@/app/operator/SignOutButton";

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

interface Destination {
  readonly href: string;
  readonly label: string;
}

/**
 * Everything an operator can reach. Ordered by how often it is wanted rather
 * than alphabetically — the pipeline first, the registers last.
 */
const DESTINATIONS: readonly Destination[] = [
  { href: "/deals", label: "Deals" },
  { href: "/capital", label: "Capital" },
  { href: "/operator/billing", label: "Billing" },
  { href: "/operator/payouts", label: "Payouts" },
  { href: "/operator/discovery", label: "Discovery" },
  { href: "/operator/outreach", label: "Outreach" },
  { href: "/operator/accounts", label: "Accounts" },
  { href: "/operator/blog", label: "Blog" },
  { href: "/operator/audit", label: "Audit" },
  { href: "/operator/conduct", label: "Conduct" },
];

export function OperatorNav({ current }: { current?: string }) {
  return (
    <nav
      aria-label="Operator"
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

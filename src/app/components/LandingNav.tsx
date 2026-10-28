"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * The landing-page navigation, responsive.
 *
 * Inline on a laptop; a hamburger that opens a dropdown on a phone. The links
 * are a mix of page routes and in-page anchors, and both the inline row and the
 * dropdown render from the one list so they cannot drift. The landing is where
 * the installed PWA opens, so a missing mobile menu reads as "no menu" — this
 * is that menu.
 */

interface Item {
  readonly href: string;
  readonly label: string;
}

const ITEMS: readonly Item[] = [
  { href: "/browse", label: "Properties" },
  { href: "/appraise", label: "Free appraisal" },
  { href: "/sell", label: "Selling" },
  { href: "/partners", label: "Agents" },
  { href: "#engine", label: "Deal Engine" },
  { href: "#stack", label: "Capital" },
  { href: "#goldmine", label: "GoldMine" },
  { href: "#close", label: "Close" },
  { href: "#pricing", label: "Pricing" },
  { href: "/join", label: "Create account" },
  { href: "/operator", label: "Sign in" },
];

function NavLink({ item, onNavigate, className }: { item: Item; onNavigate?: () => void; className: string }) {
  // An in-page anchor is a plain <a>; a route is a Link. Both close the menu.
  if (item.href.startsWith("#")) {
    return (
      <a href={item.href} onClick={onNavigate} className={className}>
        {item.label}
      </a>
    );
  }
  return (
    <Link href={item.href} onClick={onNavigate} className={className}>
      {item.label}
    </Link>
  );
}

export function LandingNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative flex items-center">
      {/* Laptop and up: inline row (the sign-in link is handled by the page). */}
      <div className="hidden items-center gap-7 text-[13px] text-ink-400 lg:flex">
        {ITEMS.filter((i) => i.href !== "/operator" && i.href !== "/join").map((item) => (
          <NavLink key={item.href} item={item} className="transition-colors hover:text-ink-100" />
        ))}
      </div>

      {/* Phone/tablet: a hamburger with the full list, sign-in included. */}
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-md border hairline bg-surface-2 text-ink-200 transition-colors hover:text-ink-100 lg:hidden"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          {open ? (
            <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          ) : (
            <path d="M2.5 5h13M2.5 9h13M2.5 13h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          )}
        </svg>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default lg:hidden"
          />
          <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border hairline bg-surface-2 p-2 shadow-xl lg:hidden">
            <ul className="flex flex-col">
              {ITEMS.map((item) => (
                <li key={item.href}>
                  <NavLink
                    item={item}
                    onNavigate={() => setOpen(false)}
                    className="block rounded-md px-3 py-2 text-sm text-ink-300 transition-colors hover:bg-surface-3 hover:text-ink-100"
                  />
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

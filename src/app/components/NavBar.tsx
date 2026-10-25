"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SignOutButton } from "@/app/operator/SignOutButton";

/**
 * The header navigation, responsive.
 *
 * One component so the operator and account navs behave identically: an inline
 * row on a laptop, and a hamburger that opens a dropdown on a phone. The
 * installed PWA is narrow and these rows are long — fifteen operator links
 * wrapped into five lines under the mark with no way to collapse them, which is
 * the giveaway that a page was only ever looked at on a desktop. The menu
 * closes on a choice and on Escape, and the links are the single source so the
 * two views can never drift.
 */

export interface NavItem {
  readonly href: string;
  readonly label: string;
}

export function NavBar({
  items,
  current,
  label,
}: {
  items: readonly NavItem[];
  current?: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  // Escape closes it, the same affordance as any menu, so a keyboard user is
  // not trapped in an open panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const linkClass = (here: boolean): string =>
    here ? "text-ink-100" : "transition-colors hover:text-ink-100";

  return (
    <nav aria-label={label} className="relative">
      {/* Laptop and up: the inline row, exactly as before. */}
      <div className="hidden items-center justify-end gap-x-5 gap-y-2 text-sm text-ink-400 sm:flex sm:flex-wrap">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.href === current ? "page" : undefined}
            className={linkClass(item.href === current)}
          >
            {item.label}
          </Link>
        ))}
        <SignOutButton />
      </div>

      {/* Phone: a hamburger that toggles the dropdown. */}
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-md border hairline bg-surface-2 text-ink-200 transition-colors hover:text-ink-100 sm:hidden"
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
          {/* A tap outside closes it. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default sm:hidden"
          />
          <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border hairline bg-surface-2 p-2 shadow-xl sm:hidden">
            <ul className="flex flex-col">
              {items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={item.href === current ? "page" : undefined}
                    className={`block rounded-md px-3 py-2 text-sm ${
                      item.href === current
                        ? "bg-surface-3 text-ink-100"
                        : "text-ink-300 transition-colors hover:bg-surface-3 hover:text-ink-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              <li className="mt-1 border-t hairline px-1 pt-1.5">
                <SignOutButton />
              </li>
            </ul>
          </div>
        </>
      )}
    </nav>
  );
}

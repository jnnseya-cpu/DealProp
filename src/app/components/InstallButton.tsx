"use client";

import { useEffect, useState } from "react";

/**
 * Install the app — a button that works when the browser's native prompt does
 * not.
 *
 * The app has always relied on the browser's own install mini-infobar, which is
 * the problem: Chrome shows it at most once and then suppresses it for a long
 * cooldown after an app is installed and removed, and iOS Safari never shows one
 * at all. So an owner who uninstalls has no way back in.
 *
 * This captures the `beforeinstallprompt` event where the browser fires it
 * (Chromium) and triggers the real install dialog on click; where it does not
 * fire — iOS, or during Chrome's post-uninstall cooldown — it shows the exact
 * manual steps instead. It hides itself when the app is already running
 * installed, so it only appears where it can do something.
 */

interface BeforeInstallPromptEvent extends Event {
  readonly prompt: () => Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: "accepted" | "dismissed" }>;
}

export function InstallButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);
  const [ios, setIos] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
    if (standalone) {
      // Already installed and running as the app — nothing to offer.
      setHidden(true);
      return;
    }
    setIos(/iphone|ipad|ipod/i.test(nav.userAgent));

    const onPrompt = (event: Event): void => {
      // Stop the browser's own infobar; we drive the dialog from the button.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = (): void => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (hidden) return null;

  async function onClick(): Promise<void> {
    if (deferred !== null) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      setDeferred(null);
      if (choice.outcome === "accepted") setHidden(true);
      return;
    }
    // No native dialog available right now (iOS, or Chrome's cooldown after a
    // previous uninstall). Show the manual route instead of doing nothing.
    setShowHelp(true);
  }

  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={() => void onClick()}
        className="inline-flex items-center gap-1.5 text-[13px] text-lode-300 transition-colors hover:text-lode-200"
      >
        <span aria-hidden>↓</span> Install the Lode app
      </button>
      {showHelp && (
        <p className="mt-2 max-w-xs text-[12px] leading-relaxed text-ink-500">
          {ios
            ? "On iPhone or iPad: open this site in Safari, tap the Share button, then “Add to Home Screen”."
            : "Open your browser menu (⋮ or ⋯) and choose “Install app” or “Add to Home screen”. If it is greyed out, it is usually the browser’s pause after an app was removed — open www.lodeprop.com directly, use it briefly, then try the menu again."}
        </p>
      )}
    </div>
  );
}

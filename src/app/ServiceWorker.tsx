"use client";

import { useEffect } from "react";

/**
 * Registers the service worker.
 *
 * Registration is what makes the app installable, and installation is what
 * makes the OS show a splash screen — a site opened in a browser tab has no
 * launch to cover.
 *
 * Registered after load rather than during render so it never competes with the
 * first paint for bandwidth, and failures are swallowed deliberately: an
 * unavailable service worker degrades the app to an ordinary website, which is
 * a perfectly good outcome and not worth an error in the user's face.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const register = (): void => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Intentionally silent — see the note above.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

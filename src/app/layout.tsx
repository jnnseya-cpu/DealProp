import type { Metadata, Viewport } from "next";
import { appleStartupImages, PWA_COLOURS } from "@shared/pwa";
import { Analytics } from "@/app/components/Analytics";
import { mono, sans, serif } from "./fonts";
import { ServiceWorker } from "./ServiceWorker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lode — Property Deal OS",
  description:
    "Problems become deals. Deals find capital. Capital closes property. An AI deal engine for motivated sellers, dealmakers and funders.",
  applicationName: "Lode",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    // Launches without Safari chrome, which is what makes iOS show a splash.
    capable: true,
    title: "Lode",
    // `black-translucent` lets the app's own dark background run under the
    // status bar. Anything else draws a light bar above a near-black app.
    statusBarStyle: "black-translucent",
    startupImage: appleStartupImages(),
  },
  formatDetection: {
    // Stops iOS turning reference numbers and figures into phone-call links.
    telephone: false,
  },
  other: {
    // Next 15 emits only the modern `mobile-web-app-capable`, having deprecated
    // the Apple-prefixed tag. Safari before iOS 16.4 reads only the prefixed
    // one, and without it the app opens in a browser tab rather than
    // standalone — and a tab launch never shows a splash screen at all. Emitted
    // explicitly so older devices still get the launch experience.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: PWA_COLOURS.theme,
  width: "device-width",
  initialScale: 1,
  // `viewport-fit=cover` is required for `black-translucent` to actually reach
  // the edges; without it iOS letterboxes the app on notched devices.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-ink-950 text-ink-100 antialiased">
        {children}
        <ServiceWorker />
        {/* Mounted once, at the root. It decides for itself whether to load
            anything: an ID must be configured, consent given, and the current
            route on the allowlist. */}
        <Analytics />
      </body>
    </html>
  );
}

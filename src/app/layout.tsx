import type { Metadata, Viewport } from "next";
import { appleStartupImages, PWA_COLOURS } from "@shared/pwa";
import { Analytics } from "@/app/components/Analytics";
import { mono, sans, serif } from "./fonts";
import { ServiceWorker } from "./ServiceWorker";
import "./globals.css";
import { companyIdentity } from "@shared/domain/identity";
import { organizationJsonLd, websiteJsonLd } from "@shared/domain/blog";
import { siteUrl, SITE_NAME } from "@backend/site";

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

/**
 * The site's own entity data, assembled from what identity is configured.
 *
 * A function rather than a constant because it reads the environment, and the
 * environment is read per render for the same reason the footer reads it per
 * render: a page prerendered at build has no company identity to bake in.
 */
function siteGraph(): Record<string, unknown> {
  const base = siteUrl();
  const identity = companyIdentity(process.env);
  const description =
    "A property deal engine: every cost charged, then the tax, then the stress tests, before anything is scored.";

  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationJsonLd({
        baseUrl: base,
        name: identity.tradingName ?? SITE_NAME,
        description,
        ...(identity.legalName !== undefined ? { legalName: identity.legalName } : {}),
        ...(identity.companyNumber !== undefined ? { companyNumber: identity.companyNumber } : {}),
        ...(identity.registeredOffice !== undefined
          ? { registeredOffice: identity.registeredOffice }
          : {}),
        ...(identity.contactEmail !== undefined ? { email: identity.contactEmail } : {}),
      }),
      websiteJsonLd({ baseUrl: base, name: identity.tradingName ?? SITE_NAME, description }),
    ],
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-ink-950 text-ink-100 antialiased">
        {/*
          The organisation and the site, once, with the ids everything else
          points at.

          Every Article names its publisher by `@id` rather than repeating a
          name, so a consumer assembling the graph ends up with one
          organisation that published many articles rather than many
          organisations that happen to share a string. Only what has been
          recorded is emitted — a structured-data block is a statement of
          identity like any other, and an invented registration number in one
          is a false statement rather than a missing one.
        */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteGraph()) }}
        />
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

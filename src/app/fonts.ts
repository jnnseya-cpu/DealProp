import { Instrument_Sans, Newsreader, IBM_Plex_Mono } from "next/font/google";

/**
 * The three typefaces, self-hosted.
 *
 * `next/font` downloads these at build time and serves them from our own
 * origin, so there is no request to Google at runtime — no third-party font
 * request to disclose, nothing to consent to, and no render-blocking hop to a
 * domain the CSP would otherwise have to allow.
 *
 * The previous stack was `ui-serif` and `ui-sans-serif`, which resolve to
 * whatever the visitor's operating system happens to ship: Palatino on a Mac,
 * something else on Windows, a third thing on Android. A financial document
 * that renders in a different typeface on every machine is not a designed
 * document, it is a default one, and it reads as such.
 *
 *  - Instrument Sans carries the interface. A neutral grotesque that holds its
 *    shape at 12px, which is the size most of this product actually is.
 *  - Newsreader carries prose and headlines. It has real optical sizing, so a
 *    48px headline and a 15px paragraph are drawn differently rather than
 *    scaled — the difference between an editorial page and a scaled-up one.
 *  - IBM Plex Mono carries references, codes and figures that must align.
 */

export const sans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans-loaded",
  weight: ["400", "500", "600", "700"],
});

export const serif = Newsreader({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display-loaded",
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
});

export const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono-loaded",
  weight: ["400", "500", "600"],
});

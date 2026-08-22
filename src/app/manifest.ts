import type { MetadataRoute } from "next";
import { PWA_COLOURS, PWA_ICONS } from "@shared/pwa";

/**
 * Web app manifest.
 *
 * Android and desktop Chrome generate the launch splash from this file alone:
 * `background_color` fills the screen, the largest icon is centred on it, and
 * `name` is drawn beneath. There is no separate splash image to supply — which
 * is why `background_color` must match the app's own background, or the splash
 * flashes one colour and the app paints another.
 *
 * iOS ignores all of that and uses the `apple-touch-startup-image` links in the
 * document head instead. Both paths are covered.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lode — Property Deal OS",
    short_name: "Lode",
    description:
      "Problems become deals. Deals find capital. Capital closes property. An AI deal engine for motivated sellers, dealmakers and funders.",
    start_url: "/",
    // `standalone` is what makes the OS show a splash at all: a browser-tab
    // launch has nothing to cover, so it never shows one.
    display: "standalone",
    orientation: "any",
    background_color: PWA_COLOURS.background,
    theme_color: PWA_COLOURS.theme,
    categories: ["business", "finance", "productivity"],
    lang: "en-GB",
    dir: "ltr",
    icons: PWA_ICONS.filter((icon) => icon.size >= 180).map((icon) => ({
      src: `/${icon.file}`,
      sizes: `${icon.size}x${icon.size}`,
      type: "image/png",
      // Android crops any icon it is given; declaring `maskable` tells it which
      // ones were drawn with the safe area allowed for, so the mark is not
      // clipped on launchers that use a circle.
      purpose: icon.maskable === true ? "maskable" : "any",
    })),
    shortcuts: [
      {
        name: "Get my deal options",
        short_name: "Sell",
        description: "Tell us the property problem and see the routes that solve it",
        url: "/sell",
      },
      {
        name: "Browse the pipeline",
        short_name: "Deals",
        description: "Every opportunity, scored after tax",
        url: "/deals",
      },
    ],
  };
}

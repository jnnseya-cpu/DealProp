import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appleStartupImages,
  IOS_DEVICES,
  PWA_COLOURS,
  PWA_ICONS,
  splashMedia,
  splashPath,
  splashPixels,
  type Orientation,
} from "@/lib/pwa";
import manifest from "@/app/manifest";

const PUBLIC = path.join(process.cwd(), "public");
const ORIENTATIONS: Orientation[] = ["portrait", "landscape"];

describe("splash assets", () => {
  it("has a file on disk for every device and orientation", () => {
    // A missing size does not error — iOS shows a blank white screen on launch,
    // which users read as a crash. This is the test that catches it.
    for (const device of IOS_DEVICES) {
      for (const orientation of ORIENTATIONS) {
        const file = path.join(PUBLIC, splashPath(device, orientation));
        expect(existsSync(file), `missing ${splashPath(device, orientation)}`).toBe(true);
      }
    }
  });

  it("declares a startup image for every generated file", () => {
    const declared = new Set(appleStartupImages().map((i) => i.url));
    for (const device of IOS_DEVICES) {
      for (const orientation of ORIENTATIONS) {
        expect(declared.has(splashPath(device, orientation))).toBe(true);
      }
    }
    expect(declared.size).toBe(IOS_DEVICES.length * ORIENTATIONS.length);
  });

  it("swaps width and height for landscape", () => {
    const device = IOS_DEVICES[0];
    if (device === undefined) throw new Error("no devices configured");
    const portrait = splashPixels(device, "portrait");
    const landscape = splashPixels(device, "landscape");
    expect(landscape.width).toBe(portrait.height);
    expect(landscape.height).toBe(portrait.width);
  });

  it("keeps device-width in portrait terms for both orientations", () => {
    // The usual reason a splash "works in portrait only": device-width and
    // device-height are always the natural portrait values, and only the
    // orientation clause differs.
    const device = IOS_DEVICES[0];
    if (device === undefined) throw new Error("no devices configured");
    const portrait = splashMedia(device, "portrait");
    const landscape = splashMedia(device, "landscape");
    expect(portrait).toContain(`(device-width: ${device.w}px)`);
    expect(landscape).toContain(`(device-width: ${device.w}px)`);
    expect(portrait).toContain("(orientation: portrait)");
    expect(landscape).toContain("(orientation: landscape)");
  });

  it("gives every device a unique media query", () => {
    // Two devices matching the same query means iOS picks arbitrarily and one
    // of them launches at the wrong resolution.
    const queries = appleStartupImages().map((i) => i.media);
    expect(new Set(queries).size).toBe(queries.length);
  });
});

describe("icons", () => {
  it("has every declared icon on disk", () => {
    for (const icon of PWA_ICONS) {
      expect(existsSync(path.join(PUBLIC, icon.file)), `missing ${icon.file}`).toBe(true);
    }
  });

  it("ships both maskable sizes Android needs", () => {
    const maskable = PWA_ICONS.filter((i) => i.maskable === true).map((i) => i.size);
    expect(maskable).toContain(192);
    expect(maskable).toContain(512);
  });
});

describe("manifest", () => {
  const m = manifest();

  it("declares standalone display, without which no splash is shown", () => {
    // A browser-tab launch has nothing to cover, so the OS never draws one.
    expect(m.display).toBe("standalone");
  });

  it("uses the app's own background colour for the splash", () => {
    // Android fills the splash with background_color. If it disagrees with the
    // app's background the launch flashes one colour then repaints another.
    expect(m.background_color).toBe(PWA_COLOURS.background);
    expect(m.theme_color).toBe(PWA_COLOURS.theme);
  });

  it("includes the 192 and 512 icons Android requires to install", () => {
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("marks maskable icons as such", () => {
    const purposes = (m.icons ?? []).map((i) => i.purpose);
    expect(purposes).toContain("maskable");
    expect(purposes).toContain("any");
  });

  it("points every icon at a file that exists", () => {
    for (const icon of m.icons ?? []) {
      const src = String(icon.src).replace(/^\//, "");
      expect(existsSync(path.join(PUBLIC, src)), `missing ${src}`).toBe(true);
    }
  });

  it("starts at a route the app serves", () => {
    expect(m.start_url).toBe("/");
  });

  it("only shortcuts to routes that exist", () => {
    const routes = new Set(["/", "/sell", "/deals", "/newsletter", "/offline"]);
    for (const shortcut of m.shortcuts ?? []) {
      expect(routes.has(String(shortcut.url))).toBe(true);
    }
  });
});

describe("service worker", () => {
  it("is present at the root scope", () => {
    // Served from /sw.js so its scope covers the whole app; nested paths would
    // silently limit which navigations it can handle.
    expect(existsSync(path.join(PUBLIC, "sw.js"))).toBe(true);
  });
});

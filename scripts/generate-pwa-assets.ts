/**
 * Generates every PWA icon and iOS splash image from one source design.
 *
 * Committed as a script rather than hand-made binaries so the assets are
 * reproducible: changing the brand means editing the markup below and re-running
 * `npm run pwa:assets`, not opening a design tool and exporting 20 files by hand
 * that then drift from the app's actual colours.
 *
 * Rasterises with the Chromium that Playwright already provides, so this adds
 * no image-processing dependency.
 *
 * The device table, icon set and colours come from src/lib/pwa.ts — the same
 * module the document head reads — so a device can never be listed in one and
 * missing from the other.
 *
 * Usage: npm run pwa:assets
 */

import { chromium, type Browser } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  IOS_DEVICES,
  PWA_COLOURS,
  PWA_ICONS,
  splashPath,
  splashPixels,
} from "../src/lib/pwa";

const { background: INK_950, foreground: INK_100, muted: INK_400, accent: LODE_400 } =
  PWA_COLOURS;

const ROOT = path.join(process.cwd(), "public");

/** The mark, as inline SVG so it scales cleanly to any density. */
function mark(size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 26 26" fill="none">
    <path d="M13 2 3 8v10l10 6 10-6V8L13 2Z" stroke="${LODE_400}" stroke-width="1.3"/>
    <path d="M8 11.5 13 8.5l5 3v5.5l-5 3-5-3v-5.5Z" fill="${LODE_400}" fill-opacity="0.22"/>
    <path d="M13 8.5v9M8 11.5l10 5.5M18 11.5 8 17" stroke="${LODE_400}" stroke-width="0.9" stroke-opacity="0.75"/>
  </svg>`;
}

/**
 * Icon artwork.
 *
 * `maskable` insets the mark to ~60% so Android can crop it to a circle,
 * squircle or rounded square without clipping the logo. A maskable icon that
 * fills its canvas gets its corners eaten on most launchers.
 */
function iconHtml(size: number, { maskable = false }: { maskable?: boolean } = {}): string {
  const inset = maskable ? 0.56 : 0.72;
  return `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;
    background:${INK_950};display:flex;align-items:center;justify-content:center;">
    <div style="width:${Math.round(size * inset)}px;height:${Math.round(size * inset)}px;
      display:flex;align-items:center;justify-content:center;">
      ${mark(Math.round(size * inset))}
    </div></body></html>`;
}

/**
 * Splash artwork.
 *
 * iOS shows this image while the app boots, so it should look like the app's
 * first frame rather than a marketing card. Mark, wordmark, and nothing else.
 *
 * Deliberately FLAT — no gradient. The app's hero uses a radial glow, and
 * copying it here produced 9MB of assets: a smooth gradient across 2732px is
 * millions of near-identical colours that PNG cannot run-length compress, and
 * every byte is downloaded before the app becomes installable. A flat field
 * compresses to a few kilobytes and is indistinguishable during the ~400ms it
 * is on screen.
 */
function splashHtml(width: number, height: number): string {
  const markSize = Math.round(Math.min(width, height) * 0.16);
  const titleSize = Math.round(Math.min(width, height) * 0.075);
  return `<!doctype html><html><body style="margin:0;width:${width}px;height:${height}px;
    background:${INK_950};overflow:hidden;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    font-family:Georgia,'Times New Roman',serif;">
    <div style="display:flex;flex-direction:column;align-items:center;">
      ${mark(markSize)}
      <div style="margin-top:${Math.round(markSize * 0.34)}px;color:${INK_100};
        font-size:${titleSize}px;letter-spacing:-0.01em;">Lode</div>
      <div style="margin-top:${Math.round(titleSize * 0.42)}px;color:${INK_400};
        font-family:-apple-system,'Segoe UI',sans-serif;
        font-size:${Math.round(titleSize * 0.26)}px;letter-spacing:0.18em;
        text-transform:uppercase;">Property Deal OS</div>
    </div></body></html>`;
}

async function shoot(
  browser: Browser,
  html: string,
  width: number,
  height: number,
  outPath: string,
): Promise<number> {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: "load" });
  const buffer = await page.screenshot({ type: "png" });
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, buffer);
  await page.close();
  return buffer.length;
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  });

  let total = 0;
  for (const icon of PWA_ICONS) {
    const bytes = await shoot(
      browser,
      iconHtml(icon.size, { maskable: icon.maskable === true }),
      icon.size,
      icon.size,
      path.join(ROOT, icon.file),
    );
    total += bytes;
    console.log(`icon    ${icon.file} (${icon.size}px, ${(bytes / 1024).toFixed(1)}kB)`);
  }

  for (const device of IOS_DEVICES) {
    for (const orientation of ["portrait", "landscape"] as const) {
      const { width: w, height: h } = splashPixels(device, orientation);
      const file = splashPath(device, orientation).replace(/^\//, "");
      const bytes = await shoot(browser, splashHtml(w, h), w, h, path.join(ROOT, file));
      total += bytes;
      console.log(`splash  ${file} (${w}x${h}, ${(bytes / 1024).toFixed(1)}kB)`);
    }
  }

  await browser.close();
  console.log(`\n${PWA_ICONS.length} icons, ${IOS_DEVICES.length * 2} splash images, ${(total / 1024).toFixed(0)}kB total`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

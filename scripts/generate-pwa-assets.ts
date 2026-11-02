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
} from "../src/shared/pwa";
import { LODE_CHIP, LODE_LOGO_SVG, LODE_MARK_SVG } from "../src/shared/brandMark";

const { background: INK_950, foreground: INK_100, muted: INK_400 } = PWA_COLOURS;

const ROOT = path.join(process.cwd(), "public");

/**
 * The mark, from the single brand source, sized for this canvas.
 *
 * The artwork carries its own colours (a near-black nugget with a gold vein),
 * so it is never recoloured. On a dark ground it would disappear, which is why
 * the icon canvas is the light chip and the splash sits it on a chip.
 */
function mark(size: number): string {
  return LODE_MARK_SVG.replace("<svg ", `<svg width="${size}" height="${size}" `);
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
  // The nugget is near-black, so the icon ground is the light chip rather than
  // ink — on ink the mark would be an invisible square. Black mark on a warm
  // off-white reads at every size from a 512 launcher down to a 32 favicon.
  return `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;
    background:${LODE_CHIP};display:flex;align-items:center;justify-content:center;">
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
  const chipPad = Math.round(markSize * 0.2);
  const titleSize = Math.round(Math.min(width, height) * 0.075);
  // The ground stays ink so the launch does not flash a colour the app does not
  // use (the manifest and the pinned test require it). The near-black mark sits
  // on a light chip so it still reads on that ink.
  return `<!doctype html><html><body style="margin:0;width:${width}px;height:${height}px;
    background:${INK_950};overflow:hidden;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    font-family:Georgia,'Times New Roman',serif;">
    <div style="display:flex;flex-direction:column;align-items:center;">
      <div style="background:${LODE_CHIP};border-radius:${Math.round(markSize * 0.24) + chipPad}px;
        padding:${chipPad}px;display:flex;">${mark(markSize)}</div>
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

  // The downloadable brand files, written from the single source so the SVGs in
  // public/brand/ can never drift from what the app and the icons draw.
  await mkdir(path.join(ROOT, "brand"), { recursive: true });
  await writeFile(path.join(ROOT, "brand", "lode-mark.svg"), `${LODE_MARK_SVG}\n`);
  await writeFile(path.join(ROOT, "brand", "lode-logo.svg"), `${LODE_LOGO_SVG}\n`);
  console.log("brand   brand/lode-mark.svg, brand/lode-logo.svg");

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

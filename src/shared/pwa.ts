/**
 * PWA install and launch configuration.
 *
 * One source of truth for the device table, the brand colours the OS shows
 * during launch, and the icon set. The asset generator and the document head
 * both read from here, so a device added in one place cannot be missing from
 * the other — which would silently produce a blank white launch screen on that
 * device and look like a crash.
 */

/** The only brand values an OS-level splash can express. */
export const PWA_COLOURS = {
  /** Painted behind the app before first paint, and behind the splash. */
  background: "#0a0a0b",
  /** Tints the status bar and task switcher. */
  theme: "#0a0a0b",
  foreground: "#e6e6ec",
  muted: "#6f6f7d",
  accent: "#d4a94b",
} as const;

export interface IosDevice {
  readonly name: string;
  /** CSS pixels. */
  readonly w: number;
  readonly h: number;
  /** Device pixel ratio. */
  readonly s: number;
}

/**
 * iOS launch-image targets.
 *
 * iOS ignores the web app manifest's splash entirely and instead matches an
 * `apple-touch-startup-image` link by exact media query. A device with no
 * matching entry gets a blank white screen while the app boots.
 *
 * Both orientations are generated: iOS does not rotate a portrait image to fill
 * a landscape launch, it shows nothing.
 */
export const IOS_DEVICES: readonly IosDevice[] = [
  { name: "iphone-16-pro-max", w: 440, h: 956, s: 3 },
  { name: "iphone-15-pro-max", w: 430, h: 932, s: 3 },
  { name: "iphone-15-pro", w: 393, h: 852, s: 3 },
  { name: "iphone-13-pro-max", w: 428, h: 926, s: 3 },
  { name: "iphone-13", w: 390, h: 844, s: 3 },
  { name: "iphone-x", w: 375, h: 812, s: 3 },
  { name: "iphone-11", w: 414, h: 896, s: 2 },
  { name: "iphone-se", w: 375, h: 667, s: 2 },
  { name: "ipad-10", w: 820, h: 1180, s: 2 },
  { name: "ipad-pro-11", w: 834, h: 1194, s: 2 },
  { name: "ipad-pro-13", w: 1024, h: 1366, s: 2 },
];

export interface IconSpec {
  readonly file: string;
  readonly size: number;
  readonly maskable?: boolean;
}

export const PWA_ICONS: readonly IconSpec[] = [
  { file: "icons/icon-192.png", size: 192 },
  { file: "icons/icon-512.png", size: 512 },
  { file: "icons/icon-maskable-192.png", size: 192, maskable: true },
  { file: "icons/icon-maskable-512.png", size: 512, maskable: true },
  { file: "icons/apple-touch-icon.png", size: 180 },
  { file: "icons/favicon-32.png", size: 32 },
];

export type Orientation = "portrait" | "landscape";

/** Pixel dimensions of the splash file for a device and orientation. */
export function splashPixels(device: IosDevice, orientation: Orientation): {
  width: number;
  height: number;
} {
  return orientation === "portrait"
    ? { width: device.w * device.s, height: device.h * device.s }
    : { width: device.h * device.s, height: device.w * device.s };
}

export function splashPath(device: IosDevice, orientation: Orientation): string {
  return `/splash/${device.name}-${orientation}.png`;
}

/**
 * The media query iOS uses to pick a launch image.
 *
 * `device-width` and `device-height` are always expressed in the device's
 * natural portrait orientation, even for the landscape image — the orientation
 * clause is what distinguishes them. Getting that backwards is the usual reason
 * a splash "works in portrait only".
 */
export function splashMedia(device: IosDevice, orientation: Orientation): string {
  return [
    `(device-width: ${device.w}px)`,
    `(device-height: ${device.h}px)`,
    `(-webkit-device-pixel-ratio: ${device.s})`,
    `(orientation: ${orientation})`,
  ].join(" and ");
}

/**
 * Every startup image, in the shape Next's metadata API expects.
 *
 * Returns a fresh mutable array each call because Next's `AppleImage[]` type is
 * mutable; handing it a shared frozen one would not type-check.
 */
export function appleStartupImages(): { url: string; media: string }[] {
  const orientations: Orientation[] = ["portrait", "landscape"];
  return IOS_DEVICES.flatMap((device) =>
    orientations.map((orientation) => ({
      url: splashPath(device, orientation),
      media: splashMedia(device, orientation),
    })),
  );
}

import sharp from "sharp";
import type { ImageKind } from "@backend/store/schema";

/**
 * Profile image processing.
 *
 * Server-only: an uploaded file is never trusted and never stored as it
 * arrived. It is decoded by sharp — which rejects anything that is not actually
 * an image — then resized to a fixed box and re-encoded as WebP. Re-encoding is
 * the point, not just the size: sharp copies no metadata unless asked, so EXIF,
 * and the GPS coordinates a phone camera writes into it, are dropped. What is
 * stored is a new file we produced, whose `content-type` we know rather than
 * the uploader's claim.
 *
 * `rotate()` with no argument reads the EXIF orientation and bakes it into the
 * pixels before the metadata is discarded, so a portrait photo does not come
 * back on its side.
 */

/** The largest upload accepted, before decoding. A decode bomb is refused by size. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** The output box for each kind. Cover is a wide banner; avatar is square. */
const SPECS: Record<ImageKind, { readonly width: number; readonly height: number }> = {
  avatar: { width: 512, height: 512 },
  cover: { width: 1600, height: 420 },
};

export interface ProcessedImage {
  readonly contentType: string;
  readonly dataBase64: string;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
}

export class ImageError extends Error {}

/**
 * Validate, re-encode and size a profile image. Throws {@link ImageError} with
 * a message safe to show a user on anything that is not a usable image.
 */
export async function processProfileImage(
  input: Buffer,
  kind: ImageKind,
): Promise<ProcessedImage> {
  if (input.byteLength === 0) throw new ImageError("The file is empty.");
  if (input.byteLength > MAX_UPLOAD_BYTES) {
    throw new ImageError("The image is larger than 8 MB. Please choose a smaller file.");
  }

  const spec = SPECS[kind];
  try {
    const { data, info } = await sharp(input)
      .rotate()
      .resize(spec.width, spec.height, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    return {
      contentType: "image/webp",
      dataBase64: data.toString("base64"),
      width: info.width,
      height: info.height,
      byteLength: data.byteLength,
    };
  } catch {
    // sharp throws on anything it cannot decode — a renamed .exe, a truncated
    // file, an SVG with a script in it. All of them are "not a usable image".
    throw new ImageError("That file could not be read as an image. Use a JPEG, PNG or WebP.");
  }
}

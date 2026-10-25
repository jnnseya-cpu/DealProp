import sharp from "sharp";
import { ImageError, MAX_UPLOAD_BYTES, type ProcessedImage } from "@backend/images/profileImage";

/**
 * Property photo processing.
 *
 * The same discipline as {@link processProfileImage}, for a different shape: a
 * wide 3:2 frame that reads as a listing photo. An uploaded file is never
 * trusted and never stored as it arrived — sharp decodes it (rejecting anything
 * that is not an image), bakes in the EXIF orientation, resizes to a fixed box
 * and re-encodes as WebP. Re-encoding is the point: sharp copies no metadata, so
 * the EXIF — and the GPS coordinates a phone camera writes into a photo taken
 * outside the property — is dropped. A photo can therefore never leak the
 * address the reveal model exists to protect.
 */

/** A 3:2 listing frame. Large enough to look good, small enough to store inline. */
const WIDTH = 1200;
const HEIGHT = 800;

export async function processPropertyImage(input: Buffer): Promise<ProcessedImage> {
  if (input.byteLength === 0) throw new ImageError("The file is empty.");
  if (input.byteLength > MAX_UPLOAD_BYTES) {
    throw new ImageError("The image is larger than 8 MB. Please choose a smaller file.");
  }

  try {
    const { data, info } = await sharp(input)
      .rotate()
      .resize(WIDTH, HEIGHT, { fit: "cover", position: "attention" })
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
    throw new ImageError("That file could not be read as an image. Use a JPEG, PNG or WebP.");
  }
}

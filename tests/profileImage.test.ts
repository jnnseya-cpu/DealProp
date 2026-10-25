import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ImageError, MAX_UPLOAD_BYTES, processProfileImage } from "@backend/images/profileImage";

/** A real raster buffer to feed the processor. */
async function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
}

describe("processProfileImage", () => {
  it("refuses an empty file", async () => {
    await expect(processProfileImage(Buffer.alloc(0), "avatar")).rejects.toBeInstanceOf(ImageError);
  });

  it("refuses something that is not an image", async () => {
    await expect(
      processProfileImage(Buffer.from("this is not an image"), "avatar"),
    ).rejects.toBeInstanceOf(ImageError);
  });

  it("refuses an oversize input before decoding", async () => {
    await expect(
      processProfileImage(Buffer.alloc(MAX_UPLOAD_BYTES + 1), "avatar"),
    ).rejects.toBeInstanceOf(ImageError);
  });

  it("re-encodes to a fixed WebP box per kind", async () => {
    const source = await png(40, 30);

    const avatar = await processProfileImage(source, "avatar");
    expect(avatar.contentType).toBe("image/webp");
    expect(avatar.width).toBe(512);
    expect(avatar.height).toBe(512);
    expect(avatar.byteLength).toBeGreaterThan(0);

    const cover = await processProfileImage(source, "cover");
    expect(cover.width).toBe(1600);
    expect(cover.height).toBe(420);
  });

  it("stores no EXIF — re-encoding strips any camera or location data", async () => {
    const out = await processProfileImage(await png(64, 64), "avatar");
    const meta = await sharp(Buffer.from(out.dataBase64, "base64")).metadata();
    expect(meta.exif).toBeUndefined();
  });
});

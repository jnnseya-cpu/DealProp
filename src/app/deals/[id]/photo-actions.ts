"use server";

import { revalidatePath } from "next/cache";
import { currentViewer } from "@/app/operator/guard";
import {
  deleteDealImage,
  getDeal,
  listDealImages,
  saveDealImage,
} from "@backend/store/repository";
import { MAX_DEAL_IMAGES } from "@backend/store/schema";
import { ImageError, MAX_UPLOAD_BYTES } from "@backend/images/profileImage";
import { processPropertyImage } from "@backend/images/propertyImage";
import { can } from "@shared/domain/accounts";

/**
 * Adding and removing property photos from the Deal Room.
 *
 * A server action is its own POST endpoint, so it checks its own permission
 * (CLAUDE.md §29) rather than trusting the page guard. Only staff — the shared
 * operator or an account that may view seller data — may touch a deal's photos,
 * the same gate the Deal Room page itself sits behind. The deal id travels in
 * the form because staff may act on any deal; it is validated against the store
 * before anything is written.
 */

export interface PhotoResult {
  readonly ok: boolean;
  readonly message?: string;
}

async function requireStaff(): Promise<boolean> {
  const viewer = await currentViewer();
  if (viewer === undefined) return false;
  return viewer.kind === "shared-operator" || can(viewer.account, "view-seller-data").allowed;
}

export async function uploadDealPhoto(_prev: PhotoResult, formData: FormData): Promise<PhotoResult> {
  if (!(await requireStaff())) return { ok: false, message: "Only staff may add property photos." };

  const dealId = String(formData.get("dealId") ?? "");
  if (dealId === "" || (await getDeal(dealId)) === undefined) {
    return { ok: false, message: "No such deal." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a photo first." };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, message: "The image is larger than 8 MB. Please choose a smaller file." };
  }

  const existing = await listDealImages(dealId);
  if (existing.length >= MAX_DEAL_IMAGES) {
    return { ok: false, message: `A property may carry up to ${MAX_DEAL_IMAGES} photos. Remove one first.` };
  }
  // The first free slot: reuse a gap left by a removal rather than letting the
  // position climb without bound, and stay within the serving route's range.
  const used = new Set(existing.map((i) => i.position));
  let position = 0;
  while (used.has(position) && position < MAX_DEAL_IMAGES) position += 1;

  try {
    const processed = await processPropertyImage(Buffer.from(await file.arrayBuffer()));
    await saveDealImage({
      id: `${dealId}:${position}`,
      dealId,
      position,
      createdAt: new Date().toISOString(),
      ...processed,
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ImageError ? error.message : "Could not process the image.",
    };
  }

  revalidatePath(`/deals/${dealId}`);
  revalidatePath(`/opportunities/${dealId}`);
  return { ok: true, message: "Photo added." };
}

export async function removeDealPhoto(_prev: PhotoResult, formData: FormData): Promise<PhotoResult> {
  if (!(await requireStaff())) return { ok: false, message: "Only staff may remove property photos." };

  const dealId = String(formData.get("dealId") ?? "");
  const position = Number(formData.get("position"));
  if (dealId === "" || !Number.isInteger(position)) {
    return { ok: false, message: "Nothing identified to remove." };
  }

  await deleteDealImage(dealId, position);
  revalidatePath(`/deals/${dealId}`);
  revalidatePath(`/opportunities/${dealId}`);
  return { ok: true, message: "Removed." };
}

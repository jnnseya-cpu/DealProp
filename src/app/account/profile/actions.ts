"use server";

import { revalidatePath } from "next/cache";
import { currentViewer } from "@/app/operator/guard";
import { deleteAccountImage, saveAccountImage } from "@backend/store/repository";
import { ImageError, MAX_UPLOAD_BYTES, processProfileImage } from "@backend/images/profileImage";
import { IMAGE_KINDS, type ImageKind } from "@backend/store/schema";

/**
 * Setting your own profile image.
 *
 * These are POST endpoints in their own right, so each checks its own
 * permission (CLAUDE.md §29) — the page guard does not cover a server action.
 * A caller may only ever write their *own* image: the account id is taken from
 * the session, never from the form, so there is no field a client could set to
 * change somebody else's picture.
 */

export interface ActionResult {
  readonly ok: boolean;
  readonly message?: string;
}

function parseKind(value: FormDataEntryValue | null): ImageKind | undefined {
  return typeof value === "string" && (IMAGE_KINDS as readonly string[]).includes(value)
    ? (value as ImageKind)
    : undefined;
}

export async function uploadProfileImage(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const viewer = await currentViewer();
  if (viewer === undefined || viewer.kind !== "account") {
    return { ok: false, message: "Sign in to change your profile image." };
  }
  const kind = parseKind(formData.get("kind"));
  if (kind === undefined) return { ok: false, message: "Unknown image kind." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a file first." };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, message: "The image is larger than 8 MB. Please choose a smaller file." };
  }

  const account = viewer.account;
  try {
    const processed = await processProfileImage(Buffer.from(await file.arrayBuffer()), kind);
    await saveAccountImage({
      id: `${account.id}:${kind}`,
      accountId: account.id,
      kind,
      createdAt: new Date().toISOString(),
      ...processed,
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof ImageError ? error.message : "Could not process the image.",
    };
  }

  revalidatePath("/account/profile");
  return { ok: true, message: kind === "avatar" ? "Profile picture updated." : "Cover image updated." };
}

export async function removeProfileImage(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const viewer = await currentViewer();
  if (viewer === undefined || viewer.kind !== "account") {
    return { ok: false, message: "Sign in first." };
  }
  const kind = parseKind(formData.get("kind"));
  if (kind === undefined) return { ok: false, message: "Unknown image kind." };

  await deleteAccountImage(viewer.account.id, kind);
  revalidatePath("/account/profile");
  return { ok: true, message: "Removed." };
}

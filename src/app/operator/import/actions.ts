"use server";

import { revalidatePath } from "next/cache";
import { requireListingImport, viewerAccount, viewerAccountId } from "@/app/operator/guard";
import { canManageImport } from "@shared/domain/accounts";
import { audit } from "@backend/audit";
import { importListing } from "@backend/discovery/listingImport";
import { listImportedListings, saveImportedListing } from "@backend/store/repository";
import {
  SUBMITTER_ROLES,
  roleToInventory,
  type ImportedListing,
  type SubmitterRole,
} from "@shared/domain/listingImport";

/**
 * Importing a listing by its link, and withdrawing one.
 *
 * An import is a publication, so it needs the three things publication needs:
 * who is submitting it, in what capacity, and their warranty that they may. The
 * engine refuses a portal and a page with no structured data; this refuses an
 * import with no warranty, because a listing we were not entitled to publish is
 * the one thing worse than no listing at all.
 */

export interface ImportResult {
  readonly ok: boolean;
  readonly message: string;
  readonly listing?: ImportedListing;
}

const ROLES = new Set<string>(SUBMITTER_ROLES.map((r) => r.value));

/** Normalise a URL to an id so a re-import updates the same draft. */
function idFor(url: string): string {
  return url.trim().toLowerCase().replace(/[#?].*$/, "").replace(/\/+$/, "");
}

export async function importListingAction(
  _previous: ImportResult | undefined,
  formData: FormData,
): Promise<ImportResult> {
  const viewer = await requireListingImport("/operator/import");
  const author = viewerAccount(viewer);
  const ownerAccountId = viewerAccountId(viewer);

  const url = String(formData.get("url") ?? "").trim();
  const roleRaw = String(formData.get("role") ?? "");
  const warranted = formData.get("warranty") === "yes";

  if (url === "") return { ok: false, message: "Paste the link to the listing." };
  if (!ROLES.has(roleRaw)) return { ok: false, message: "Say who you are in relation to this property." };
  if (!warranted) {
    return {
      ok: false,
      message: "Confirm you have the right to publish this property before importing it.",
    };
  }
  const role = roleRaw as SubmitterRole;

  const result = await importListing(url);
  if (!result.ok || result.value === undefined) {
    return { ok: false, message: result.reason };
  }

  const { category, confirmedBy } = roleToInventory(role);
  const now = new Date().toISOString();
  await saveImportedListing({
    id: idFor(result.value.sourceUrl),
    listing: result.value,
    role,
    category,
    confirmedBy,
    warrantedBy: author?.email ?? "operator",
    ...(ownerAccountId !== undefined ? { ownerAccountId } : {}),
    submittedAt: now,
    status: "draft",
  });

  await audit("mandate-saved", {
    ...(author !== undefined ? { account: author } : {}),
    subject: `imported-listing:${idFor(result.value.sourceUrl)}`,
    detail: `Imported as ${category} from ${result.value.publisherHost}, warranted by ${author?.email ?? "operator"}.`,
  });

  revalidatePath("/operator/import");
  revalidatePath("/account/listings");
  return { ok: true, message: result.reason, listing: result.value };
}

export async function withdrawImportedListingAction(
  _previous: { ok: boolean; message: string } | undefined,
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const viewer = await requireListingImport("/operator/import");
  const author = viewerAccount(viewer);

  const id = String(formData.get("id") ?? "").trim();
  if (id === "") return { ok: false, message: "No listing identified." };
  const entry = (await listImportedListings()).find((l) => l.id === id);
  if (entry === undefined) return { ok: false, message: "No such imported listing." };

  // Row-level: a partner may withdraw only their own listing. The shared
  // operator and any account with manage-mandates may withdraw any.
  if (viewer.kind === "account") {
    const decision = canManageImport(viewer.account, entry.ownerAccountId);
    if (!decision.allowed) return { ok: false, message: decision.reason };
  }

  await saveImportedListing({ ...entry, status: "withdrawn" });
  await audit("mandate-deleted", {
    ...(author !== undefined ? { account: author } : {}),
    subject: `imported-listing:${id}`,
    detail: "Withdrawn.",
  });

  revalidatePath("/operator/import");
  revalidatePath("/account/listings");
  return { ok: true, message: "Withdrawn." };
}

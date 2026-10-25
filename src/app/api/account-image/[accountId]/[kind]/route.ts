import { currentViewer } from "@/app/operator/guard";
import { getAccountImage } from "@backend/store/repository";
import { IMAGE_KINDS, type ImageKind } from "@backend/store/schema";
import { can } from "@shared/domain/accounts";

export const dynamic = "force-dynamic";

/**
 * Serve a profile image.
 *
 * Not public. A profile picture is personal data, so the only people who may
 * fetch one are the account it belongs to and staff who can already see the
 * accounts list. Everyone else gets a 403 — the same deny-by-default posture as
 * every operator surface. The bytes come straight from the store; nothing is
 * computed here.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ accountId: string; kind: string }> },
) {
  const { accountId, kind } = await params;
  if (!(IMAGE_KINDS as readonly string[]).includes(kind)) {
    return new Response("Not found", { status: 404 });
  }

  const viewer = await currentViewer();
  if (viewer === undefined) return new Response("Unauthorized", { status: 401 });

  const isOwner = viewer.kind === "account" && viewer.account.id === accountId;
  const isStaff =
    viewer.kind === "shared-operator" ||
    (viewer.kind === "account" && can(viewer.account, "view-seller-data").allowed);
  if (!isOwner && !isStaff) return new Response("Forbidden", { status: 403 });

  const image = await getAccountImage(accountId, kind as ImageKind);
  if (image === undefined) return new Response("Not found", { status: 404 });

  return new Response(Buffer.from(image.dataBase64, "base64"), {
    headers: {
      "content-type": image.contentType,
      "content-length": String(image.byteLength),
      // Private: it is personal data and the URL is guessable, so it must never
      // be cached by a shared proxy. The viewer's browser may hold it briefly.
      "cache-control": "private, max-age=60",
    },
  });
}

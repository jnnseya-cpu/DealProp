import { currentViewer } from "@/app/operator/guard";
import { getDealImage } from "@backend/store/repository";
import { MAX_DEAL_IMAGES } from "@backend/store/schema";
import { can } from "@shared/domain/accounts";

export const dynamic = "force-dynamic";

/**
 * Serve a property photo.
 *
 * Not public. A photo is shown to the two audiences the marketplace already
 * admits to deal material: staff (who run the pipeline) and an account that may
 * view deal material (the buying side). Everyone else gets a 403 — the same
 * deny-by-default posture as every surface that touches a deal. The photo
 * carries no address text and its EXIF was stripped on upload, but it is still
 * shown only to people the reveal model already lets see the opportunity. The
 * bytes come straight from the store; nothing is computed here.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ dealId: string; position: string }> },
) {
  const { dealId, position } = await params;
  const index = Number(position);
  if (!Number.isInteger(index) || index < 0 || index >= MAX_DEAL_IMAGES) {
    return new Response("Not found", { status: 404 });
  }

  const viewer = await currentViewer();
  if (viewer === undefined) return new Response("Unauthorized", { status: 401 });

  const allowed =
    viewer.kind === "shared-operator" ||
    (viewer.kind === "account" &&
      (can(viewer.account, "view-seller-data").allowed ||
        can(viewer.account, "view-deal-material").allowed));
  if (!allowed) return new Response("Forbidden", { status: 403 });

  const image = await getDealImage(dealId, index);
  if (image === undefined) return new Response("Not found", { status: 404 });

  return new Response(Buffer.from(image.dataBase64, "base64"), {
    headers: {
      "content-type": image.contentType,
      "content-length": String(image.byteLength),
      // Private: a deal photo is only for people already admitted to the deal,
      // so a shared proxy must never cache it. The viewer's browser may briefly.
      "cache-control": "private, max-age=300",
    },
  });
}

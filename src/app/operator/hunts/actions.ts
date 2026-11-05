"use server";

import { redirect } from "next/navigation";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { createAndRunHunt } from "@backend/dealHunt/service";
import { fromMajor } from "@shared/money";
import type { CriteriaDraft } from "@shared/domain/dealHunt";

/**
 * Run a confirmed Deal Hunt. Its own POST endpoint, checking its own permission
 * (#29); a hunt is attributed to the named operator's account, never the shared
 * password. The draft is re-validated server-side — the browser's values are an
 * input, not a decision (DH02).
 */
export async function runHuntAction(formData: FormData): Promise<void> {
  const viewer = await requirePermission("view-audit-log", "/operator/hunts");
  const account = viewerAccount(viewer);
  const brief = String(formData.get("brief") ?? "");
  const backTo = `/operator/hunts?brief=${encodeURIComponent(brief)}`;
  if (account === undefined) {
    redirect(`${backTo}&error=${encodeURIComponent("A hunt needs a named operator account, not the shared password.")}`);
  }

  const str = (k: string): string => String(formData.get(k) ?? "").trim();
  const intOrUndef = (k: string): number | undefined => {
    const v = str(k);
    if (v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : undefined;
  };

  const priceMajor = intOrUndef("priceCeilingMajor");
  const dropPercent = Number(str("minimumDropPercent"));
  const types = str("propertyTypes")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t !== "");
  const operator = str("priceOperator") === "lte" ? "lte" : "lt";
  const event = str("eventRequirement") === "confirmed_fall_through" ? "confirmed_fall_through" : "returned_to_market";

  const draft: CriteriaDraft = {
    geographyId: str("geographyId"),
    propertyTypes: types,
    ...(intOrUndef("bedroomsMin") !== undefined ? { bedroomsMin: intOrUndef("bedroomsMin") } : {}),
    ...(intOrUndef("bedroomsMax") !== undefined ? { bedroomsMax: intOrUndef("bedroomsMax") } : {}),
    ...(priceMajor !== undefined ? { askingPriceLimitPence: Number(fromMajor(priceMajor)) } : {}),
    priceOperator: operator,
    ...(intOrUndef("returnedWithinDays") !== undefined ? { returnedWithinDays: intOrUndef("returnedWithinDays") } : {}),
    eventRequirement: event,
    minimumDropBps: Number.isFinite(dropPercent) ? Math.round(dropPercent * 100) : 0,
  };

  const result = await createAndRunHunt({ investorId: account.id, draft, briefRef: brief.slice(0, 500) });
  if (!result.ok || result.outcome === undefined) {
    const msg = (result.errors ?? ["The hunt could not be run."]).join(" ");
    redirect(`${backTo}&error=${encodeURIComponent(msg)}`);
  }
  redirect(`/operator/hunts/${result.outcome.run.id}`);
}

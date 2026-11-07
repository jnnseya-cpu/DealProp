"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { requirePermission } from "@/app/operator/guard";
import { buildLayoutHypothesis } from "@shared/domain/floorplan";
import type { AuctionLot, AuctionOutcome } from "@shared/domain/auction";
import { mergeProperties, reverseMerge } from "@shared/domain/propertyResolution";
import {
  saveLayoutHypothesis,
  saveAuctionLot,
  savePropertyMerge,
  getPropertyMerge,
} from "@backend/store/repository";
import { fromMajor } from "@shared/money";

/**
 * Record a floorplan layout hypothesis (IND10). Deterministic and honest: an
 * unscaled plan is stored as a hypothesis with no dimensions permitted. Its own
 * POST endpoint checking its own permission (#29).
 */
export async function recordFloorplanAction(formData: FormData): Promise<void> {
  await requirePermission("view-audit-log", "/operator/specialist");
  const propertyId = String(formData.get("propertyId") ?? "").trim();
  const proposedChange = String(formData.get("proposedChange") ?? "").trim();
  if (propertyId === "" || proposedChange === "") redirect("/operator/specialist?error=missing");
  const scaleReadable = formData.get("scaleReadable") === "on";
  const page = Number(String(formData.get("page") ?? "1")) || 1;

  const hypothesis = buildLayoutHypothesis({
    id: randomUUID(),
    tenantId: "lode",
    propertyId,
    planVersion: String(formData.get("planVersion") ?? "plan-1").trim() || "plan-1",
    page,
    coordinateUnits: scaleReadable ? "mm" : "unknown",
    scaleReadable,
    proposedChange,
    regions: [], // regions come from an extractor; manual entry records the change only
    createdAt: new Date().toISOString(),
  });
  await saveLayoutHypothesis(hypothesis);
  redirect(`/operator/specialist?property=${encodeURIComponent(propertyId)}`);
}

/**
 * Record an auction lot (IND11). Availability stays unverified unless a
 * confirmation date is given; only confirmed charges carry into appraisal. Its
 * own POST endpoint checking its own permission (#29).
 */
export async function recordAuctionAction(formData: FormData): Promise<void> {
  await requirePermission("view-audit-log", "/operator/specialist");
  const propertyId = String(formData.get("propertyId") ?? "").trim();
  if (propertyId === "") redirect("/operator/specialist?error=missing");

  const guideMajor = Number(String(formData.get("guideMajor") ?? ""));
  const premiumMajor = Number(String(formData.get("premiumMajor") ?? ""));
  const outcome = String(formData.get("outcome") ?? "availability-unknown") as AuctionOutcome;
  const confirmedAt = String(formData.get("availabilityConfirmedAt") ?? "").trim();
  const auctionDate = String(formData.get("auctionDate") ?? "").trim() || new Date().toISOString();

  const lot: AuctionLot = {
    id: randomUUID(),
    propertyId,
    ...(Number.isFinite(guideMajor) && guideMajor > 0 ? { guidePence: fromMajor(Math.round(guideMajor)) } : {}),
    charges:
      Number.isFinite(premiumMajor) && premiumMajor > 0
        ? [{ label: "Buyer's premium", amountPence: fromMajor(Math.round(premiumMajor)), confirmed: formData.get("premiumConfirmed") === "on" }]
        : [],
    auctionDate,
    conditions: [],
    outcome,
    ...(confirmedAt !== "" ? { availabilityConfirmedAt: new Date(confirmedAt).toISOString() } : {}),
  };

  await saveAuctionLot({
    id: lot.id,
    tenantId: "lode",
    propertyId,
    lot,
    createdAt: new Date().toISOString(),
  });
  redirect(`/operator/specialist?property=${encodeURIComponent(propertyId)}`);
}

/**
 * Record a property-identity merge (§19.4/MW14): a named reviewer confirming two
 * records are one home. Reversible — the record is marked, never deleted — so a
 * split rebuilds each history. Its own POST endpoint checking its own
 * permission (#29). A named reviewer is required: this is a judgement, not an
 * automatic action.
 */
export async function recordMergeAction(formData: FormData): Promise<void> {
  await requirePermission("view-audit-log", "/operator/specialist");
  const survivingPropertyId = String(formData.get("survivingPropertyId") ?? "").trim();
  const mergedPropertyId = String(formData.get("mergedPropertyId") ?? "").trim();
  const reviewer = String(formData.get("reviewer") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (survivingPropertyId === "" || mergedPropertyId === "" || reviewer === "" || survivingPropertyId === mergedPropertyId) {
    redirect("/operator/specialist?error=merge-invalid");
  }
  const record = mergeProperties({
    id: randomUUID(),
    survivingPropertyId,
    mergedPropertyId,
    by: reviewer,
    reason: reason === "" ? "Confirmed the same property." : reason,
    at: new Date().toISOString(),
  });
  await savePropertyMerge(record);
  redirect("/operator/specialist?merged=1");
}

/** Reverse a merge (a split, MW14). Named reviewer; the audit is preserved. */
export async function reverseMergeAction(formData: FormData): Promise<void> {
  await requirePermission("view-audit-log", "/operator/specialist");
  const id = String(formData.get("id") ?? "").trim();
  const reviewer = String(formData.get("reviewer") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (id === "" || reviewer === "") redirect("/operator/specialist?error=merge-invalid");
  const existing = await getPropertyMerge(id);
  if (existing === undefined || existing.reversed !== undefined) {
    redirect("/operator/specialist?error=cannot-reverse");
  }
  await savePropertyMerge(
    reverseMerge(existing, reviewer, reason === "" ? "Not the same property after all." : reason, new Date().toISOString()),
  );
  redirect("/operator/specialist?split=1");
}

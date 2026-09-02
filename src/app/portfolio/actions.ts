"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { getDeal, saveDeal } from "@backend/store/repository";
import { audit } from "@backend/audit";
import { fromMajor, pct } from "@shared/money";
import type { HoldingFacts } from "@shared/domain/portfolio";

/**
 * Recording what is known about a property somebody now owns.
 *
 * Split by what establishes each fact. A valuation comes from a valuer on a
 * date; a facility comes from a lender with a term on it; rent comes from a
 * tenancy. One form writing all three would invite somebody to fill in the
 * part they have and blank the rest, and the blanked figures are the ones the
 * refinance countdown reads.
 */

export interface HoldingResult {
  readonly ok: boolean;
  readonly message: string;
}

function isoDate(raw: FormDataEntryValue | null): string | undefined {
  const value = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

function amount(raw: FormDataEntryValue | null): number | undefined {
  const value = Number(String(raw ?? "").replace(/[,\s£]/g, ""));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

async function update(
  dealId: string,
  change: (current: HoldingFacts) => HoldingFacts,
  what: string,
): Promise<HoldingResult> {
  const viewer = await requirePermission("view-seller-data", "/portfolio");
  const account = viewerAccount(viewer);

  const record = await getDeal(dealId);
  if (record === undefined) return { ok: false, message: "No such property." };
  if (record.status !== "completed") {
    return {
      ok: false,
      message: "A property enters the portfolio when it completes, and this one has not.",
    };
  }

  const facts = change(record.holding ?? { completedAt: new Date().toISOString() });
  await saveDeal({ ...record, holding: facts });
  await audit("holding-recorded", {
    ...(account !== undefined ? { account } : {}),
    subject: dealId,
    detail: what,
  });

  revalidatePath("/portfolio");
  return { ok: true, message: `Recorded: ${what}.` };
}

export async function recordValuationAction(
  _previous: HoldingResult | undefined,
  formData: FormData,
): Promise<HoldingResult> {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const valuation = amount(formData.get("valuation"));
  const valuedAt = isoDate(formData.get("valuedAt"));
  const valuer = String(formData.get("valuer") ?? "").trim();
  const spent = amount(formData.get("spent"));

  if (valuation === undefined || valuedAt === undefined || valuer === "") {
    return {
      ok: false,
      message:
        "A valuation needs a figure, a date and a valuer. Without all three it is an opinion, and the portfolio would present it as evidence.",
    };
  }

  return update(
    dealId,
    (current) => ({
      ...current,
      valuation: fromMajor(valuation),
      valuedAt,
      valuer,
      ...(spent !== undefined ? { spent: fromMajor(spent) } : {}),
    }),
    "valuation",
  );
}

export async function recordFacilityAction(
  _previous: HoldingResult | undefined,
  formData: FormData,
): Promise<HoldingResult> {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const debt = amount(formData.get("debt"));
  const rate = Number(String(formData.get("rate") ?? "").replace(/[\s%]/g, ""));
  const endsAt = isoDate(formData.get("endsAt"));

  if (debt === undefined) return { ok: false, message: "State the debt outstanding." };
  if (!Number.isFinite(rate) || rate < 0) return { ok: false, message: "State the rate." };
  if (debt > 0 && endsAt === undefined) {
    return {
      ok: false,
      message:
        "Give the date the facility ends. A bridge with no end date in the system is a bridge nobody is counting down, and the countdown is the whole point.",
    };
  }

  return update(
    dealId,
    (current) => ({
      ...current,
      debt: fromMajor(debt),
      debtRateBps: pct(rate),
      ...(endsAt !== undefined ? { facilityEndsAt: endsAt } : {}),
    }),
    "facility",
  );
}

export async function recordRentAction(
  _previous: HoldingResult | undefined,
  formData: FormData,
): Promise<HoldingResult> {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const rent = amount(formData.get("rent"));
  if (rent === undefined) return { ok: false, message: "State the monthly rent, or zero." };
  return update(dealId, (current) => ({ ...current, monthlyRent: fromMajor(rent) }), "rent");
}

export async function recordSaleAction(
  _previous: HoldingResult | undefined,
  formData: FormData,
): Promise<HoldingResult> {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const soldAt = isoDate(formData.get("soldAt"));
  if (soldAt === undefined) return { ok: false, message: "Give the date it sold." };
  // Marked, never deleted. A property that was held was held, and the record
  // of what it did is the thing that makes the next appraisal better.
  return update(dealId, (current) => ({ ...current, soldAt }), "sale");
}

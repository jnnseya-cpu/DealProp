"use server";

import type { BoxFormResult } from "@shared/formFields";
import type { BuyBox } from "@shared/domain/matching";
import { matchBuyBox, MATCH_HORIZON } from "@shared/domain/matching";
import { scoreDeal } from "@shared/domain/dealScore";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { pageDeals } from "@backend/store/repository";
import { consume, callerFrom } from "@backend/rateLimit";
import { headers as nextHeaders } from "next/headers";
import { parseBuyBoxFields } from "./parse";

/**
 * Preview a Buy Box without an account.
 *
 * Public by design: it writes nothing and reveals nothing. It runs the real
 * matching engine over the live pipeline and returns only a COUNT — how many
 * opportunities a mandate like this would match right now. A count is
 * aggregate; it carries no address, no seller, no figure about any one deal,
 * so it is safe to hand a logged-out visitor. Saving the mandate and seeing the
 * matches themselves needs a (free, quick) account, which is the one thing this
 * deliberately cannot do.
 */
export async function previewBuyBox(
  _previous: BoxFormResult | undefined,
  formData: FormData,
): Promise<BoxFormResult> {
  const gate = consume("intake", callerFrom(await nextHeaders()));
  if (!gate.allowed) return { ok: false, message: "One moment — too many previews in a row. Try again shortly." };

  let box: BuyBox;
  try {
    box = { id: "preview", ...parseBuyBoxFields(formData) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Please check the criteria." };
  }

  const page = await pageDeals(MATCH_HORIZON);
  const n = page.rows.filter(
    (record) => matchBuyBox(box, scoreDeal(toWorkingDeal(record.inputs).inputs)).eligible,
  ).length;

  return {
    ok: true,
    message:
      n === 0
        ? "Nothing on the market matches these criteria right now. Create an account to save this Buy Box and we will alert you the moment one does."
        : `${n} ${n === 1 ? "opportunity matches" : "opportunities match"} these criteria right now. Create an account to save this Buy Box, see them, and get alerts as new ones arrive.`,
  };
}

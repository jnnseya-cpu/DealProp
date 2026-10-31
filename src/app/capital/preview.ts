"use server";

import type { BoxFormResult } from "@shared/formFields";
import type { FundingBox } from "@shared/domain/matching";
import { matchFundingBox, MATCH_HORIZON } from "@shared/domain/matching";
import { scoreDeal } from "@shared/domain/dealScore";
import { toWorkingDeal } from "@shared/domain/workingDeal";
import { pageDeals } from "@backend/store/repository";
import { consume, callerFrom } from "@backend/rateLimit";
import { headers as nextHeaders } from "next/headers";
import { parseFundingBoxFields } from "./parse";

/** The criterion a guest cannot satisfy — it is about the funder, not the deal. */
const VERIFICATION_CRITERION = "Funder verified";

/**
 * Preview a Funding Box without an account.
 *
 * Public by design: writes nothing, reveals nothing — only a count. The one
 * subtlety is the funder-verification gate: an unverified funder matches
 * nothing, which is correct for a real introduction but would make every
 * preview read zero. So the preview counts deals that fit the TERMS, ignoring
 * only the verification criterion, and says plainly that matching happens once
 * the lender signs up and is verified. A count is aggregate and carries no
 * detail about any one deal, so it is safe to show.
 */
export async function previewFundingBox(
  _previous: BoxFormResult | undefined,
  formData: FormData,
): Promise<BoxFormResult> {
  const gate = consume("intake", callerFrom(await nextHeaders()));
  if (!gate.allowed) return { ok: false, message: "One moment — too many previews in a row. Try again shortly." };

  let box: FundingBox;
  try {
    box = { id: "preview", ...parseFundingBoxFields(formData) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Please check the terms." };
  }

  const page = await pageDeals(MATCH_HORIZON);
  const n = page.rows.filter((record) => {
    const match = matchFundingBox(
      box,
      scoreDeal(toWorkingDeal(record.inputs).inputs),
      record.borrowerCompletedDeals,
    );
    // Deal-fit: every criterion met except the one about the funder's own
    // verification, which only a signed-up, checked lender can clear.
    return match.criteria.filter((c) => c.label !== VERIFICATION_CRITERION).every((c) => c.met);
  }).length;

  return {
    ok: true,
    message:
      n === 0
        ? "Nothing on the market fits these terms right now. Create an account to save this Funding Box and we will alert you when something does."
        : `${n} ${n === 1 ? "deal fits" : "deals fit"} these terms right now. Create an account to save this Funding Box; once we have verified you as a lender, you will be matched to them.`,
  };
}

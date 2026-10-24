"use client";

import { useEffect } from "react";
import { clearDraft } from "./draft";

/**
 * Clears the saved intake draft once the seller reaches their options page.
 *
 * Reaching a real enquiry id means the submission succeeded, so the draft has
 * done its job. Clearing it here (rather than on submit) is deliberate: a
 * submit that bounces back for missing consent or the rate limit must keep the
 * draft, and only the success destination knows the difference.
 */
export function ClearSellDraft() {
  useEffect(() => {
    clearDraft();
  }, []);
  return null;
}

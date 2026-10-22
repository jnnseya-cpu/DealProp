import { runDealDirector } from "@shared/domain/director";
import type { DealInputs } from "@shared/domain/types";
import { fromMajor } from "@shared/money";
import { gbp, gbpSigned, percent } from "@shared/format";
import { computed } from "@backend/agent/provenance";
import { toolError, type AgentTool } from "@backend/agent/tools";

/**
 * The deal-analysis tools, bound to one deal's inputs.
 *
 * `appraise_deal` is the agent's only way to obtain a Deal Score, a margin, a
 * true discount, a profit or a ceiling. It runs the same engine as the Deal
 * Room, after tax, on the deal's real inputs (or a price the agent is testing),
 * and every figure it returns is stamped `computed` — so when the agent reports
 * one, it is the engine's number with the engine's name on it, never the
 * model's invention.
 */
export function dealAnalysisTools(inputs: DealInputs): readonly AgentTool[] {
  return [
    {
      name: "appraise_deal",
      description:
        "Compute the full after-tax appraisal and Deal Score for this property at a purchase price. Returns the engine's figures. You MUST call this for any number you report — never state a figure this tool did not return.",
      inputSchema: {
        type: "object",
        properties: {
          purchasePrice: {
            type: "number",
            description: "Purchase price in whole pounds. Omit to use the recorded modelled price.",
          },
        },
        additionalProperties: false,
      },
      async run(input: unknown) {
        const raw = (input as { purchasePrice?: unknown } | null)?.purchasePrice;
        let used = inputs;
        if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
          used = { ...inputs, purchasePrice: fromMajor(raw) };
        } else if (raw !== undefined) {
          return toolError("purchasePrice must be a positive number of whole pounds, or omitted.");
        }

        const briefing = runDealDirector(used);
        const a = briefing.scored.appraisal;
        const data = {
          dealScore: computed(briefing.scored.breakdown.composite, "appraise_deal"),
          verdict: computed(briefing.verdict, "appraise_deal"),
          marginOnGdv: computed(percent(a.marginOnGdvBps, 1), "appraise_deal"),
          trueDiscount: computed(percent(a.trueDiscountBps, 1), "appraise_deal"),
          profitAfterTax: computed(gbpSigned(a.profit), "appraise_deal"),
          highestViablePrice: computed(gbp(briefing.maxViablePrice), "appraise_deal"),
        } as const;
        const summary =
          `Deal Score ${data.dealScore.value}/100 (verdict: ${briefing.verdict}). ` +
          `Margin on GDV ${data.marginOnGdv.value}; true discount to value ${data.trueDiscount.value}; ` +
          `profit after tax ${data.profitAfterTax.value}; highest viable price ${data.highestViablePrice.value}. ` +
          briefing.headline;
        return { ok: true, summary, data };
      },
    },
  ];
}

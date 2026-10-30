"use client";

import { useState } from "react";
import type { Tier } from "@shared/domain/revenue";
import { gbp } from "@shared/format";

/**
 * The plan tiers with a buyer / lender toggle.
 *
 * Both sets are derived from `pricing.ts` (via `revenue.ts`), so the toggle
 * only chooses which published list to show — it never restates a price. The
 * middle tier is the highlighted one, computed from the list length so it works
 * whatever each audience has.
 */
export function PricingTiers({ buyer, funder }: { buyer: readonly Tier[]; funder: readonly Tier[] }) {
  const [audience, setAudience] = useState<"buyer" | "funder">("buyer");
  const tiers = audience === "buyer" ? buyer : funder;
  const highlight = Math.floor(tiers.length / 2);

  return (
    <div>
      <div className="flex justify-center">
        <div className="inline-flex rounded-xl border hairline bg-surface-2 p-1" role="tablist" aria-label="Pricing audience">
          {(["buyer", "funder"] as const).map((a) => (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={audience === a}
              onClick={() => setAudience(a)}
              className={`rounded-lg px-4 py-1.5 text-[13px] font-medium transition-colors ${
                audience === a ? "bg-lode-400 text-ink-950" : "text-ink-300 hover:text-ink-100"
              }`}
            >
              {a === "buyer" ? "Buyers" : "Lenders"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {tiers.map((t, i) => (
          <div
            key={t.name}
            className={`flex flex-col rounded-2xl border px-6 py-7 ${
              i === highlight ? "border-lode-500/40 bg-lode-400/5" : "hairline bg-surface-2"
            }`}
          >
            <p className="text-sm font-medium text-ink-100">{t.name}</p>
            <p className="tnum mt-2 text-[24px] leading-none text-ink-100">
              {t.monthly === 0 ? "Free" : gbp(t.monthly)}
              {t.monthly !== 0 && <span className="text-sm text-ink-400">/mo</span>}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-400">{t.summary}</p>
            <ul className="mt-5 space-y-2 border-t hairline pt-5">
              {t.features.map((f) => (
                <li key={f} className="flex gap-2 text-xs leading-relaxed text-ink-300">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-lode-400" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

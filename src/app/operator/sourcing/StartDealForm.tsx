"use client";

import { useActionState, useState } from "react";
import { enrichLead, startDealFromLead } from "./actions";
import type { SourcedLead } from "@shared/domain/sourcedLead";

const INIT = { ok: false, message: "" };

const TYPES = [
  { value: "house", label: "House" },
  { value: "flat", label: "Flat" },
  { value: "bungalow", label: "Bungalow" },
  { value: "hmo", label: "HMO" },
  { value: "commercial", label: "Commercial" },
  { value: "mixed-use", label: "Mixed use" },
  { value: "land", label: "Land" },
];

const TENURES = [
  { value: "freehold", label: "Freehold" },
  { value: "leasehold", label: "Leasehold" },
  { value: "share-of-freehold", label: "Share of freehold" },
  { value: "unknown", label: "Unknown" },
];

const JURISDICTIONS = [
  { value: "GB-ENG", label: "England" },
  { value: "GB-WLS", label: "Wales" },
  { value: "GB-SCT", label: "Scotland" },
  { value: "GB-NIR", label: "Northern Ireland" },
];

/**
 * Turn a probate lead into a deal, with the fields pre-filled from the registers.
 *
 * On open it enriches the address from the EPC register and Price Paid: the
 * property type and floor area from the EPC, the tenure and last sold price
 * from Land Registry. The operator confirms the value (anchored to the last
 * sale) and submits; the action creates the deal and lands on seller-checks.
 * Nothing is invented — a register miss just leaves a field for the operator.
 */
export function StartDealForm({ lead }: { lead: SourcedLead }) {
  const [state, action, pending] = useActionState(startDealFromLead, INIT);

  const [value, setValue] = useState("");
  const [type, setType] = useState("house");
  const [tenure, setTenure] = useState("freehold");
  const [floorArea, setFloorArea] = useState<number | undefined>(undefined);
  const [soldLabel, setSoldLabel] = useState<string | undefined>(undefined);
  const [enriching, setEnriching] = useState(false);
  const [tried, setTried] = useState(false);

  async function onOpen() {
    if (tried || lead.postcode === undefined) return;
    setTried(true);
    setEnriching(true);
    try {
      const e = await enrichLead({
        address: lead.propertyAddress ?? "",
        postcode: lead.postcode,
      });
      if (e.propertyType !== undefined) setType(e.propertyType);
      if (e.tenure !== undefined) setTenure(e.tenure);
      if (e.floorAreaSqm !== undefined) setFloorArea(e.floorAreaSqm);
      if (e.lastSoldPounds !== undefined) {
        setValue(String(e.lastSoldPounds));
        setSoldLabel(
          `last sold £${e.lastSoldPounds.toLocaleString("en-GB")}${
            e.lastSoldAt !== undefined ? ` in ${e.lastSoldAt.slice(0, 4)}` : ""
          }`,
        );
      }
    } catch {
      /* leave the fields for the operator */
    } finally {
      setEnriching(false);
    }
  }

  return (
    <details
      className="mt-3 rounded-lg border hairline bg-surface-2"
      onToggle={(e) => {
        if (e.currentTarget.open) void onOpen();
      }}
    >
      <summary className="cursor-pointer px-4 py-2.5 text-sm text-ink-200">
        Start a deal from this lead →
      </summary>
      <form action={action} className="border-t hairline px-4 py-3">
        <input type="hidden" name="postcode" value={lead.postcode ?? ""} />
        <input type="hidden" name="address" value={lead.propertyAddress ?? ""} />
        <input type="hidden" name="subjectName" value={lead.subjectName ?? ""} />
        <input type="hidden" name="contactForService" value={lead.contactForService ?? ""} />
        <input type="hidden" name="signal" value={lead.signalKey} />
        {/* Carried so the action can suppress this lead from future runs once it
            becomes a deal — the address key for a property, the notice URL for a
            notice. */}
        <input type="hidden" name="addressKey" value={lead.addressKey ?? ""} />
        <input type="hidden" name="sourceUrl" value={lead.sourceUrl ?? ""} />

        <p className="text-[13px] leading-relaxed text-ink-400">
          {lead.propertyAddress ?? lead.postcode}
          {enriching && <span className="ml-2 text-ink-500">· checking the EPC register &amp; Land Registry…</span>}
          {!enriching && (floorArea !== undefined || soldLabel !== undefined) && (
            <span className="ml-2 text-emerald-300/80">
              · {[floorArea !== undefined ? `${floorArea} m²` : undefined, soldLabel]
                .filter((s) => s !== undefined)
                .join(" · ")}
            </span>
          )}
        </p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className="text-[12px] text-ink-400">
            Estimated value (£)
            <input
              type="number"
              name="estimatedValue"
              min={1}
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="250000"
              className="mt-1 w-full rounded-md border hairline bg-surface-1 px-2.5 py-1.5 text-sm text-ink-100 tabular-nums"
            />
          </label>
          <label className="text-[12px] text-ink-400">
            Property type
            <select
              name="propertyType"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="mt-1 w-full rounded-md border hairline bg-surface-1 px-2.5 py-1.5 text-sm text-ink-100"
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12px] text-ink-400">
            Tenure
            <select
              name="tenure"
              value={tenure}
              onChange={(e) => setTenure(e.target.value)}
              className="mt-1 w-full rounded-md border hairline bg-surface-1 px-2.5 py-1.5 text-sm text-ink-100"
            >
              {TENURES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12px] text-ink-400">
            Nation
            <select
              name="jurisdiction"
              defaultValue="GB-ENG"
              className="mt-1 w-full rounded-md border hairline bg-surface-1 px-2.5 py-1.5 text-sm text-ink-100"
            >
              {JURISDICTIONS.map((j) => (
                <option key={j.value} value={j.value}>
                  {j.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="mt-3 inline-flex h-8 items-center rounded-md bg-lode-400 px-3 text-[13px] font-medium text-ink-950 transition-colors hover:bg-lode-300 disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create deal & verify →"}
        </button>

        {state.message !== "" && <p className="mt-2 text-[12px] text-red-300">{state.message}</p>}
        <p className="mt-2 text-[11px] leading-snug text-ink-500">
          Type, tenure and the value anchor are pre-filled from the EPC register and Land Registry
          where they match. Confirm the value — it drives the score — and refine the rest on the deal.
        </p>
      </form>
    </details>
  );
}

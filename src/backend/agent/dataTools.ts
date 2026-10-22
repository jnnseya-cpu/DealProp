import { fetchCertificates } from "@backend/sources/epc";
import { fetchPricePaid, latestSale, medianPrice } from "@backend/sources/landRegistry";
import type { DealInputs } from "@shared/domain/types";
import { gbp } from "@shared/format";
import { fromSource, type Sourced } from "@backend/agent/provenance";
import { toolError, type AgentTool } from "@backend/agent/tools";
import { dealAnalysisTools } from "@backend/agent/dealTools";

/**
 * The live-data tools: real market facts, read from licensed sources.
 *
 * These are what let the agent be live AND never fabricated. Every figure they
 * return is stamped `from <source>` — a real floor area from the EPC register,
 * a real sold price from HM Land Registry — so when the agent uses one it is
 * citing an actual record, not a model's guess. Both readers are licence-gated
 * (`assertSourceUsable` throws before any request) and fail closed: with no key
 * or no network the tool reports that the source is unavailable, never a made-up
 * number.
 *
 * No AVM, by decision: a registered sold price is a fact; an automated valuation
 * is a model's estimate, and this platform prefers the fact. Price Paid Data
 * gives a range from real completions, which is the most defensible open-market
 * evidence available for nothing.
 */

const EPC = "EPC register";
const PPD = "Land Registry Price Paid Data";

function postcodeFrom(input: unknown, fallback: string): string {
  const given = (input as { postcode?: unknown } | null)?.postcode;
  if (typeof given === "string" && given.trim() !== "") return given.trim();
  return fallback.trim();
}

export function liveDataTools(
  defaultPostcode: string,
  opts: { readonly fetchImpl?: typeof fetch } = {},
): readonly AgentTool[] {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return [
    {
      name: "epc_lookup",
      description:
        "Look up the Energy Performance Certificate for the property's postcode: real floor area (for price per square metre), construction age band, rating and lodgement date. Use its floor area for any per-square-metre reasoning — never estimate floor area yourself.",
      inputSchema: {
        type: "object",
        properties: {
          postcode: { type: "string", description: "Full postcode. Omit to use the deal's recorded postcode." },
        },
        additionalProperties: false,
      },
      async run(input: unknown) {
        const postcode = postcodeFrom(input, defaultPostcode);
        if (postcode === "") return toolError("No postcode available to look up.");
        let certificates;
        try {
          certificates = await fetchCertificates(postcode, { fetchImpl });
        } catch (error) {
          return toolError(`EPC register unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
        const cert = [...certificates].sort((a, b) => b.lodgedAt.localeCompare(a.lodgedAt))[0];
        if (cert === undefined) {
          return { ok: true, summary: `No EPC certificate found for ${postcode}. That is an absence, not a finding.` };
        }
        const ref = cert.postcode !== "" ? cert.postcode : postcode;
        const data: Record<string, Sourced<string | number>> = {
          epcLodgedAt: fromSource(cert.lodgedAt, EPC, ref, cert.lodgedAt),
        };
        if (cert.floorAreaSqm !== undefined) data.floorAreaSqm = fromSource(cert.floorAreaSqm, EPC, ref, cert.lodgedAt);
        if (cert.rating !== undefined) data.epcRating = fromSource(cert.rating, EPC, ref, cert.lodgedAt);
        if (cert.constructionAgeBand !== undefined) {
          data.constructionAgeBand = fromSource(cert.constructionAgeBand, EPC, ref, cert.lodgedAt);
        }
        const summary =
          `EPC for ${ref}: ${cert.floorAreaSqm !== undefined ? `${cert.floorAreaSqm} sqm` : "floor area not stated"}` +
          `${cert.rating !== undefined ? `, rating ${cert.rating}` : ""}, lodged ${cert.lodgedAt}` +
          `${cert.constructionAgeBand !== undefined ? `, built ${cert.constructionAgeBand}` : ""}.`;
        return { ok: true, summary, data };
      },
    },
    {
      name: "sold_comparables",
      description:
        "Real registered sold prices near the property, from HM Land Registry Price Paid Data (arm's-length sales only). Use these as comparable evidence for open market value — they are actual completions, not estimates, and set a range rather than this property's exact value.",
      inputSchema: {
        type: "object",
        properties: {
          postcode: { type: "string", description: "Full postcode. Omit to use the deal's recorded postcode." },
        },
        additionalProperties: false,
      },
      async run(input: unknown) {
        const postcode = postcodeFrom(input, defaultPostcode);
        if (postcode === "") return toolError("No postcode available to look up.");
        let records;
        try {
          records = await fetchPricePaid(postcode, { fetchImpl });
        } catch (error) {
          return toolError(`Price Paid Data unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
        const arms = records.filter((r) => r.armsLength);
        if (arms.length === 0) {
          return { ok: true, summary: `No arm's-length registered sales found for ${postcode}. That is an absence, not a finding.` };
        }
        const median = medianPrice(records);
        const latest = latestSale(records);
        const data: Record<string, Sourced<string | number>> = {
          comparableCount: fromSource(arms.length, PPD, postcode),
        };
        if (median !== undefined) data.medianSoldPrice = fromSource(gbp(median), PPD, postcode);
        if (latest !== undefined) {
          const ref = latest.address !== "" ? latest.address : postcode;
          data.latestSalePrice = fromSource(gbp(latest.price), PPD, ref, latest.date);
          data.latestSaleDate = fromSource(latest.date, PPD, ref, latest.date);
        }
        const summary =
          `${arms.length} arm's-length registered sale${arms.length === 1 ? "" : "s"} near ${postcode}. ` +
          `Median ${median !== undefined ? gbp(median) : "not available"}. ` +
          `Most recent ${latest !== undefined ? `${gbp(latest.price)} on ${latest.date}` : "not available"}. ` +
          "These are actual completions, not estimates; they set a range, not this property's exact value.";
        return { ok: true, summary, data };
      },
    },
  ];
}

/**
 * The full tool set for analysing one deal: the after-tax engine, plus the live
 * sources. This is what a user-facing analysis flow hands to `runAgent`.
 */
export function dealAgentTools(
  inputs: DealInputs,
  opts: { readonly fetchImpl?: typeof fetch } = {},
): readonly AgentTool[] {
  return [...dealAnalysisTools(inputs), ...liveDataTools(inputs.property.postcodeArea, opts)];
}

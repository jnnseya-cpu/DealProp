import { fetchCertificates, fetchFloorArea, type EpcCertificate } from "@backend/sources/epc";
import { fetchSales } from "@backend/sources/pricePaid";
import { addressKey, splitAddressLine, type PricePaidRecord } from "@backend/discovery/properties";
import { messageOf } from "@backend/report";
import type { Money } from "@shared/money";
import type { PropertyType } from "@shared/domain/types";

/**
 * What the open registers add to an address the Gazette gave us.
 *
 * The Gazette carries no property attributes at all — just the name, the
 * address, the deadline and the contact. These come from the EPC register and
 * Land Registry Price Paid, matched to the same address, so "Start a deal"
 * pre-fills the type, the tenure and a real value anchor instead of a guess.
 * Everything is optional: a miss is a field the operator fills, never a made-up
 * value, and the notes say which source matched and which did not.
 */
export interface EnrichedProperty {
  readonly propertyType?: PropertyType;
  readonly tenure?: "freehold" | "leasehold";
  readonly floorAreaSqm?: number;
  /** The last registered sale price — a value anchor, not a valuation. */
  readonly lastSoldPrice?: Money;
  readonly lastSoldAt?: string;
  /** What matched and what did not, for the operator and for diagnosis. */
  readonly notes: readonly string[];
}

function epcType(raw: string | undefined): PropertyType | undefined {
  if (raw === undefined) return undefined;
  const t = raw.toLowerCase();
  if (t.includes("bungalow")) return "bungalow";
  if (t.includes("flat") || t.includes("maisonette")) return "flat";
  if (t.includes("house")) return "house";
  return undefined;
}

function ppdType(code: string): PropertyType | undefined {
  if (code === "F") return "flat";
  if (code === "D" || code === "S" || code === "T") return "house";
  return undefined;
}

export interface EnrichOptions {
  readonly epc?: (postcode: string) => Promise<readonly EpcCertificate[]>;
  readonly sales?: (postcode: string) => Promise<readonly PricePaidRecord[]>;
  /** Floor area by certificate number, for when the search summary omits it. */
  readonly floorArea?: (certificateNumber: string) => Promise<number | undefined>;
}

/**
 * Enrich one address from the EPC register and Price Paid. Each source is tried
 * independently and its failure is caught and noted — a credential that is not
 * set, or an endpoint that cannot be reached, degrades to "fill it yourself"
 * rather than failing the whole lookup.
 */
export async function enrichAddress(
  address: string,
  postcode: string,
  opts: EnrichOptions = {},
): Promise<EnrichedProperty> {
  const notes: string[] = [];
  const pc = postcode.toUpperCase().trim();
  const { paon, street } = splitAddressLine((address.split(",")[0] ?? address).trim());
  const target = addressKey({ postcode: pc, paon, street });

  let propertyType: PropertyType | undefined;
  let tenure: "freehold" | "leasehold" | undefined;
  let floorAreaSqm: number | undefined;
  let lastSoldPrice: Money | undefined;
  let lastSoldAt: string | undefined;

  const epc = opts.epc ?? ((p: string) => fetchCertificates(p));
  const sales = opts.sales ?? ((p: string) => fetchSales(p));
  const floorAreaFetch = opts.floorArea ?? ((id: string) => fetchFloorArea(id));

  try {
    const certs = await epc(pc);
    const match = certs.find(
      (c) => addressKey({ postcode: c.postcode, ...splitAddressLine(c.addressLine1) }) === target,
    );
    if (match !== undefined) {
      propertyType = epcType(match.propertyType);
      floorAreaSqm = match.floorAreaSqm;
      notes.push("EPC: matched this address.");
      // The 2026 search summary omits floor area; fetch it from the certificate
      // detail on demand, since this enrichment runs when an operator opens a
      // single lead rather than for every search row.
      if (floorAreaSqm === undefined && match.lmkKey !== "") {
        try {
          const area = await floorAreaFetch(match.lmkKey);
          if (area !== undefined) {
            floorAreaSqm = area;
            notes.push("EPC: floor area from the certificate detail.");
          }
        } catch (error) {
          notes.push(`EPC detail: ${messageOf(error)}`);
        }
      }
    } else {
      notes.push(`EPC: ${certs.length} certificate(s) in the postcode, none matched the address.`);
    }
  } catch (error) {
    notes.push(`EPC: ${messageOf(error)}`);
  }

  try {
    const rows = await sales(pc);
    // Newest first already; the first matching row is the last sale.
    const match = rows.find(
      (s) =>
        addressKey({ postcode: s.postcode, paon: s.paon, saon: s.saon, street: s.street }) === target,
    );
    if (match !== undefined) {
      lastSoldPrice = match.price;
      lastSoldAt = match.soldAt;
      if (match.tenure === "F") tenure = "freehold";
      else if (match.tenure === "L") tenure = "leasehold";
      if (propertyType === undefined) propertyType = ppdType(match.propertyType);
      notes.push(`Price Paid: matched (last sold ${match.soldAt}).`);
    } else {
      notes.push(`Price Paid: ${rows.length} sale(s) in the postcode, none matched the address.`);
    }
  } catch (error) {
    notes.push(`Price Paid: ${messageOf(error)}`);
  }

  return {
    ...(propertyType !== undefined ? { propertyType } : {}),
    ...(tenure !== undefined ? { tenure } : {}),
    ...(floorAreaSqm !== undefined ? { floorAreaSqm } : {}),
    ...(lastSoldPrice !== undefined ? { lastSoldPrice } : {}),
    ...(lastSoldAt !== undefined ? { lastSoldAt } : {}),
    notes,
  };
}

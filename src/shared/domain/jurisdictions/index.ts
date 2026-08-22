import type { JurisdictionCode } from "@shared/domain/types";
import type { JurisdictionPack } from "./types";
import { GB_ENG } from "./gb-eng";
import { GB_SCT } from "./gb-sct";
import { US_GEN } from "./us-gen";

/**
 * Wales has its own Land Transaction Tax and Northern Ireland follows SDLT.
 * Wales is mapped to the England pack only as an explicit interim measure and
 * is flagged as unsupported for live deals, rather than being silently absent.
 */
const PACKS: Record<JurisdictionCode, JurisdictionPack> = {
  "GB-ENG": GB_ENG,
  // Northern Ireland borrows the England rates but NOT its letting energy
  // standard: MEES is an England and Wales instrument and does not extend
  // here. Inheriting it would flag compliant Northern Irish landlords as
  // forced sellers, which is the failure mode the jurisdiction split exists to
  // prevent.
  "GB-NIR": niPack(),
  "GB-SCT": GB_SCT,
  "GB-WLS": {
    ...GB_ENG,
    code: "GB-WLS",
    name: "Wales (using England rates — NOT deal-ready)",
    transferTaxLabel: "LTT (approximated with SDLT — do not rely on)",
    obligations: [
      ...GB_ENG.obligations,
      {
        key: "wales-ltt",
        label: "Land Transaction Tax not yet modelled",
        detail:
          "Wales levies Land Transaction Tax with its own bands and higher-rate surcharge. This pack currently borrows the England SDLT calculation and will be wrong. Do not use for live deals.",
        authority: "Welsh Revenue Authority",
      },
    ],
  },
  "US-GEN": US_GEN,
};

/** Jurisdictions whose rate tables have been verified for live use. */
const DEAL_READY: ReadonlySet<JurisdictionCode> = new Set<JurisdictionCode>([
  "GB-ENG",
  "GB-NIR",
  "GB-SCT",
]);

function niPack(): JurisdictionPack {
  const { lettingEnergyStandard: _unused, ...rest } = GB_ENG;
  return { ...rest, code: "GB-NIR", name: "Northern Ireland" };
}

export function getJurisdiction(code: JurisdictionCode): JurisdictionPack {
  const pack = PACKS[code];
  if (pack === undefined) {
    throw new Error(`No jurisdiction pack registered for ${code}`);
  }
  return pack;
}

export function isDealReady(code: JurisdictionCode): boolean {
  return DEAL_READY.has(code);
}

export function allJurisdictions(): readonly JurisdictionPack[] {
  return Object.values(PACKS);
}

export type { JurisdictionPack, StructureRuling, StructurePermission } from "./types";
export { GB_ENG, GB_SCT, US_GEN };

import { NextResponse } from "next/server";
import { companyIdentity, identityGaps, registrationLine } from "@shared/domain/identity";
import { sellerFeeStatement } from "@shared/domain/fees";
import { permissionsHeld } from "@backend/permissions";

export const dynamic = "force-dynamic";

/**
 * The footer's statutory identity, read at runtime.
 *
 * The company identity (registered name, number, place, office, ICO…) is RUNTIME
 * configuration in this build — it lives in the VPS's app.env and is never baked
 * into the image. Static and ISR pages that render the footer were therefore
 * prerendered at build time with an empty identity and then served that stale
 * HTML, which is why the footer showed "company identity has not been
 * configured" on a site whose identity was in fact set. The footer now reads
 * this endpoint from the client instead, so every page — static, ISR or SSG —
 * shows the live, configured details without being made dynamic.
 *
 * Everything returned here is PUBLIC by law: the Companies Act requires these
 * details on every page, so there is no secret to protect. No secret, token or
 * internal value is included.
 */
export function GET(): NextResponse {
  const identity = companyIdentity(process.env);
  return NextResponse.json({
    registration: registrationLine(identity) ?? null,
    contactEmail: identity.contactEmail ?? null,
    contactPhone: identity.contactPhone ?? null,
    registeredOffice: identity.registeredOffice ?? null,
    icoRegistration: identity.icoRegistration ?? null,
    amlSupervision: identity.amlSupervision ?? null,
    redressScheme: identity.redressScheme ?? null,
    blockingGaps: identityGaps(identity)
      .filter((g) => g.blocking)
      .map((g) => g.label),
    feeStatement: sellerFeeStatement(permissionsHeld(process.env.HELD_PERMISSIONS)).statement,
  });
}

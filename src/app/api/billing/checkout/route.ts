import { NextResponse } from "next/server";
import { permissionsHeld } from "@backend/permissions";
import { cookies } from "next/headers";
import { readSession, SESSION_COOKIE } from "@backend/auth/session";
import { getAccount, listCreditLots, listLedgerEntries } from "@backend/store/repository";
import { standing } from "@shared/domain/ledger";
import {
  amountInMinorUnits,
  authorisePurchase,
  CURRENCY,
  type PurchaseRequest,
} from "@shared/domain/charging";
import { PLANS, type CustomerKind } from "@shared/domain/pricing";
import { quoteRevealForDeal } from "@backend/billing/reveal";
import { siteUrl } from "@backend/site";
import { createCharge, providerConfig } from "@backend/billing/provider";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * Authorise a purchase, server-side, and return what may be charged.
 *
 * Note what the request body cannot contain: an amount. There is no field for
 * one, so there is nothing for a client to set to zero. It names a plan or a
 * pack and the price comes from the catalogue here.
 *
 * This is the half of checkout that decides. Handing the authorised figure to a
 * payment provider is the other half, and it fails closed without one — the
 * same rule the webhook, the cron endpoints and the email transport follow. An
 * unconfigured deployment must not be able to take money in a way nothing can
 * later confirm.
 *
 * The account is read from the session, never from the body. A checkout that
 * accepts an account id charges one person and credits another.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const jar = await cookies();
  const claims = await readSession(jar.get(SESSION_COOKIE)?.value, process.env.OPERATOR_SECRET);
  if (claims === undefined) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });
  }

  const account = await getAccount(claims.accountId);
  if (account === undefined || account.disabledAt !== undefined) {
    return NextResponse.json({ error: "No account." }, { status: 401, headers: NO_STORE });
  }

  let body: {
    kind?: unknown;
    planId?: unknown;
    packId?: unknown;
    opportunityId?: unknown;
    country?: unknown;
    customerKind?: unknown;
    vatNumber?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Unreadable." }, { status: 400, headers: NO_STORE });
  }

  const purchase = purchaseFrom(body);
  if (purchase === undefined) {
    return NextResponse.json(
      { error: "Name a plan, a credit pack or an opportunity." },
      { status: 400, headers: NO_STORE },
    );
  }

  // A reveal is priced from the opportunity, and the opportunity is quoted on
  // the server. The request names which one; it never names its class, and
  // therefore never its price — a request that could name its own class could
  // buy a portfolio disposal at the standard-residential price.
  const offer =
    purchase.kind === "reveal"
      ? await quoteRevealForDeal(purchase.opportunityId, account)
      : undefined;

  if (purchase.kind === "reveal" && offer === undefined) {
    return NextResponse.json({ error: "No such opportunity." }, { status: 404, headers: NO_STORE });
  }

  const [lots, entries] = await Promise.all([
    listCreditLots(account.id),
    listLedgerEntries(account.id),
  ]);
  const position = standing(lots, entries, new Date());

  const authorisation = authorisePurchase(purchase, {
    customer: {
      country: typeof body.country === "string" ? body.country : "GB",
      kind: body.customerKind === "business" ? ("business" as CustomerKind) : ("consumer" as CustomerKind),
      ...(typeof body.vatNumber === "string" ? { vatNumber: body.vatNumber } : {}),
    },
    permissionsHeld: permissionsHeld(),
    owesUs: !position.maySpend,
    ...(offer !== undefined ? { reveal: offer.quote } : {}),
  });

  if (!authorisation.allowed) {
    // 422 rather than 400: the request was understood and refused on its merits,
    // and the reason is one the customer needs to read.
    return NextResponse.json(
      { status: "refused", reason: authorisation.reason },
      { status: 422, headers: NO_STORE },
    );
  }

  const providerConfigured =
    (process.env.BILLING_WEBHOOK_SECRET ?? "") !== "" && (process.env.BILLING_CHECKOUT_URL ?? "") !== "";

  if (!providerConfigured) {
    return NextResponse.json(
      {
        status: "no-provider",
        // The authorisation is real and is returned, because it is the part this
        // platform decides. What is missing is somewhere to send it.
        authorised: {
          description: authorisation.description,
          amountMinorUnits: amountInMinorUnits(authorisation.price),
          currency: CURRENCY,
          net: authorisation.price.net,
          tax: authorisation.price.tax,
          taxTreatment: authorisation.price.treatment,
        },
        reason:
          "Authorised, but no payment provider is connected. Set BILLING_CHECKOUT_URL and BILLING_WEBHOOK_SECRET; nothing is charged until both exist.",
      },
      { status: 503, headers: NO_STORE },
    );
  }

  // The charge is created here, with the figure this platform computed. The
  // route previously stopped at "authorised" and imported `createCharge`
  // without calling it, which meant every button on the billing page led
  // nowhere — the catalogue, the ledger and the entitlements were all correct
  // and nothing could take a penny. A control with no call site is not a
  // control, and a checkout with no call site is not a checkout.
  const origin = siteUrl();
  const charge = await createCharge({
    accountId: account.id,
    description: authorisation.description,
    amountMinorUnits: amountInMinorUnits(authorisation.price),
    currency: CURRENCY,
    ...(purchase.kind === "plan" ? { planId: purchase.planId } : {}),
    ...(purchase.kind === "topup" ? { packId: purchase.packId } : {}),
    ...(purchase.kind === "reveal" ? { opportunityId: purchase.opportunityId } : {}),
    returnUrl: `${origin}/account/billing/complete?charge={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${origin}/account/billing`,
  });

  if (!charge.ok || charge.redirectUrl === undefined) {
    // 502 rather than 500: this platform did its part and the provider did
    // not. The pending charge is already recorded, so nothing is lost.
    return NextResponse.json(
      { status: "provider-failed", reason: charge.reason },
      { status: 502, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      status: "authorised",
      redirectUrl: charge.redirectUrl,
      description: authorisation.description,
      amountMinorUnits: amountInMinorUnits(authorisation.price),
      currency: CURRENCY,
      net: authorisation.price.net,
      tax: authorisation.price.tax,
      taxTreatment: authorisation.price.treatment,
      reason: authorisation.reason,
    },
    { headers: NO_STORE },
  );
}

/** A request names what is being bought. It never names what it costs. */
function purchaseFrom(body: {
  kind?: unknown;
  planId?: unknown;
  packId?: unknown;
  opportunityId?: unknown;
}): PurchaseRequest | undefined {
  if (body.kind === "plan" && typeof body.planId === "string") {
    const known = PLANS.find((p) => p.id === body.planId);
    // Narrowed against the catalogue rather than cast into it. The previous
    // conditional type asserted the string was a PlanId and asserted nothing
    // about whether such a plan existed.
    if (known === undefined) return undefined;
    return { kind: "plan", planId: known.id };
  }
  if (body.kind === "topup" && typeof body.packId === "string") {
    return { kind: "topup", packId: body.packId };
  }
  if (body.kind === "reveal" && typeof body.opportunityId === "string" && body.opportunityId !== "") {
    return { kind: "reveal", opportunityId: body.opportunityId };
  }
  return undefined;
}

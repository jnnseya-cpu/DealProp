import { NextResponse } from "next/server";
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
import type { CustomerKind } from "@shared/domain/pricing";

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

  let body: { kind?: unknown; planId?: unknown; packId?: unknown; country?: unknown; customerKind?: unknown; vatNumber?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Unreadable." }, { status: 400, headers: NO_STORE });
  }

  const purchase = purchaseFrom(body);
  if (purchase === undefined) {
    return NextResponse.json(
      { error: "Name a plan or a credit pack." },
      { status: 400, headers: NO_STORE },
    );
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
    permissionsHeld: (process.env.HELD_PERMISSIONS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    owesUs: !position.maySpend,
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

  return NextResponse.json(
    {
      status: "authorised",
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
function purchaseFrom(body: { kind?: unknown; planId?: unknown; packId?: unknown }): PurchaseRequest | undefined {
  if (body.kind === "plan" && typeof body.planId === "string") {
    return { kind: "plan", planId: body.planId as PurchaseRequest extends { planId: infer P } ? P : never };
  }
  if (body.kind === "topup" && typeof body.packId === "string") {
    return { kind: "topup", packId: body.packId };
  }
  return undefined;
}

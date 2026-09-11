import { NextResponse, type NextRequest } from "next/server";
import { baselineCsp, carriesPersonalData, noncedCsp } from "@shared/csp";
import { OPERATOR_COOKIE, verifyOperatorCookie } from "@backend/auth/operator";
import { readSession, SESSION_COOKIE } from "@backend/auth/session";

/**
 * Deny-by-default gate over the operator surfaces.
 *
 * This is middleware rather than a check called at the top of each page on
 * purpose: a guard that has to be remembered is a guard that gets forgotten the
 * first time somebody adds a route. The matcher below is the security boundary,
 * so a new operator page is protected by existing here, not by anyone
 * remembering to protect it.
 *
 * The seller's own options page is deliberately NOT matched. A seller has no
 * account and reaches their result from a link we sent them; that link is a
 * capability, which is the same model as the newsletter confirm and unsubscribe
 * links. It carries only their own data.
 */
export async function middleware(request: NextRequest) {
  const secret = process.env.OPERATOR_SECRET;

  /*
   * Minted per request from a CSPRNG, and passed to the render.
   *
   * Next reads the nonce out of the request's own Content-Security-Policy
   * header and applies it to the script tags it emits, so the header has to be
   * set on the request as well as the response. `crypto` is the Web Crypto
   * global — this runs in the edge runtime, where `node:crypto` is not
   * available.
   */
  const path = request.nextUrl.pathname;
  const personal = carriesPersonalData(path);

  /*
   * A nonce, but only where it can be honoured.
   *
   * Next reads the nonce out of the request's own Content-Security-Policy
   * header and applies it to the script tags it emits, so the header goes on
   * the request as well as the response. `crypto` is the Web Crypto global:
   * this runs in the edge runtime, where `node:crypto` does not exist.
   *
   * On a prerendered page the nonce in the header would not appear in the
   * HTML, and Next's own bootstrap scripts would be blocked — a policy that
   * breaks the site, which is worse than the weaker one. So the public pages
   * get the baseline instead, and the split is the whole design rather than an
   * omission.
   */
  const nonce = personal ? Buffer.from(crypto.randomUUID()).toString("base64") : undefined;
  const csp = nonce === undefined ? baselineCsp() : noncedCsp(nonce);

  const withCsp = (): NextResponse => {
    if (nonce === undefined) {
      const response = NextResponse.next();
      response.headers.set("content-security-policy", csp);
      return response;
    }
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("content-security-policy", csp);
    requestHeaders.set("x-nonce", nonce);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("content-security-policy", csp);
    return response;
  };

  // Everything not behind the gate still gets a policy, and nothing else.
  if (!GATED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return withCsp();
  }

  if (secret === undefined || secret === "") {
    // Fail closed. These pages carry seller screening answers, including health
    // and capacity concerns, and an unconfigured deployment must not serve them
    // to anyone who finds the URL.
    return new NextResponse(
      "Operator access is not configured. Set OPERATOR_SECRET before serving this page.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  // Either credential gets past this gate: the shared operator password, or a
  // signed per-account session. Middleware is the coarse check — it verifies
  // the signature and nothing else, because the edge runtime has no database.
  // Role, disabled state and investor certification are read from the account
  // record by the per-page guard, which is where the real decision is made and
  // where withdrawing access takes effect immediately.
  if (await verifyOperatorCookie(request.cookies.get(OPERATOR_COOKIE)?.value, secret)) {
    return withCsp();
  }
  if ((await readSession(request.cookies.get(SESSION_COOKIE)?.value, secret)) !== undefined) {
    return withCsp();
  }

  const signIn = new URL("/operator", request.url);
  signIn.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(signIn);
}

/**
 * The paths the authentication gate covers.
 *
 * The matcher below is now every path, because every response needs a
 * Content-Security-Policy and middleware is the only place that can set a
 * per-request one. That makes this list the security boundary instead — and
 * it is a list rather than a matcher so that the gate and the policy can be
 * read side by side.
 */
const GATED: readonly string[] = [
  "/deals",
  "/invest",
  "/opportunities",
  "/portfolio",
  "/capital",
  // Certification attaches to a signed-in person, so the page behind it is
  // gated too — otherwise the form would accept a statement from nobody.
  "/account",
];

export const config = {
  /*
   * Every path, so every response carries a policy — except the ones where a
   * header would be meaningless or harmful. Next's own static chunks are
   * immutable and already covered by the policy of the document that loads
   * them; the PWA icons are images; and running middleware over them would
   * cost a function invocation per asset for nothing.
   *
   * The authentication decision is made from `GATED` above, not from this
   * matcher. That is a change worth noticing: the matcher used to be the
   * boundary, and now the list is.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webmanifest|txt|xml)$).*)"],
};

import { NextResponse, type NextRequest } from "next/server";
import { OPERATOR_COOKIE, verifyOperatorCookie } from "@/lib/operator";

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

  if (secret === undefined || secret === "") {
    // Fail closed. These pages carry seller screening answers, including health
    // and capacity concerns, and an unconfigured deployment must not serve them
    // to anyone who finds the URL.
    return new NextResponse(
      "Operator access is not configured. Set OPERATOR_SECRET before serving this page.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const cookie = request.cookies.get(OPERATOR_COOKIE)?.value;
  if (await verifyOperatorCookie(cookie, secret)) {
    return NextResponse.next();
  }

  const signIn = new URL("/operator", request.url);
  signIn.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(signIn);
}

export const config = {
  // `:path*` matches the bare path as well as anything below it, so `/deals`
  // and `/deals/deal-0001` are both covered.
  matcher: ["/deals/:path*", "/invest/:path*", "/capital/:path*"],
};

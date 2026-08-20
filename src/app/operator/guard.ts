import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { assertOperator, OPERATOR_COOKIE, OperatorAccessDenied } from "@/lib/operator";

/**
 * Server-side operator guard, called at the top of every operator page.
 *
 * `src/middleware.ts` is the gate and this is the lock behind it. Next.js has
 * shipped middleware-bypass advisories more than once, and these pages render
 * seller screening answers including reported health and capacity concerns.
 * Defence in depth is cheap here: one await per page.
 *
 * Redirects rather than 404s, so a signed-out operator following a bookmark
 * lands on the sign-in form and returns to where they were going.
 */
export async function requireOperator(returnTo: string): Promise<void> {
  const jar = await cookies();
  try {
    await assertOperator(jar.get(OPERATOR_COOKIE)?.value);
  } catch (error) {
    if (error instanceof OperatorAccessDenied) {
      redirect(`/operator?next=${encodeURIComponent(returnTo)}`);
    }
    throw error;
  }
}

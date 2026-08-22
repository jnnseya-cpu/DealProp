import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { assertOperator, OPERATOR_COOKIE } from "@/lib/operator";
import { readSession, SESSION_COOKIE } from "@/lib/session";
import { can, type Account, type Permission } from "@/domain/accounts";
import { getAccount } from "@/store/repository";
import { audit } from "@/lib/audit";

/**
 * Server-side access guards, called at the top of every protected page.
 *
 * `src/middleware.ts` is the outer gate and these are the locks behind it.
 * Next.js has shipped middleware-bypass advisories more than once, and these
 * pages render seller screening answers including reported health and capacity
 * concerns. Defence in depth is cheap here: one await per page.
 *
 * Two levels, because there are two kinds of caller:
 *
 *  - `requireOperator()` — the shared password. Kept because it is what
 *    bootstraps the first account and what a solo operator uses on day one.
 *  - `requireAccount()` — a named person, whose role and certification are read
 *    from the record on every request, and whose access is written to the audit
 *    trail. This is what the shared password could never do.
 */

/** The identity behind the current request, however it was established. */
export type Viewer =
  | { readonly kind: "account"; readonly account: Account }
  /** The shared operator password. No person is identified. */
  | { readonly kind: "shared-operator" };

/** Reads the current viewer without redirecting. Undefined when signed out. */
export async function currentViewer(): Promise<Viewer | undefined> {
  const jar = await cookies();
  const secret = process.env.OPERATOR_SECRET;

  const claims = await readSession(jar.get(SESSION_COOKIE)?.value, secret);
  if (claims !== undefined) {
    const account = await getAccount(claims.accountId);
    // A session for an account that has since been deleted or disabled is not a
    // session. Both are read fresh on every request precisely so that
    // withdrawing access takes effect now rather than in eight hours.
    if (account !== undefined && account.disabledAt === undefined) {
      return { kind: "account", account };
    }
    return undefined;
  }

  try {
    await assertOperator(jar.get(OPERATOR_COOKIE)?.value);
    return { kind: "shared-operator" };
  } catch {
    return undefined;
  }
}

/**
 * Require a specific permission, redirecting to sign-in or to a reason.
 *
 * The shared operator password satisfies staff permissions, because it is the
 * bootstrap and a solo operator has nothing else. It cannot satisfy anything
 * that attaches to a person — a certification is a statement somebody signed,
 * and there is nobody behind a shared password to have signed it.
 */
export async function requirePermission(
  permission: Permission,
  returnTo: string,
): Promise<Viewer> {
  const viewer = await currentViewer();

  if (viewer === undefined) {
    redirect(`/operator?next=${encodeURIComponent(returnTo)}`);
  }

  if (viewer.kind === "shared-operator") return viewer;

  const decision = can(viewer.account, permission);
  if (!decision.allowed) {
    await audit("access-denied", {
      account: viewer.account,
      subject: returnTo,
      detail: decision.reason,
    });
    redirect(`/operator/denied?reason=${encodeURIComponent(decision.reason)}`);
  }
  return viewer;
}

/**
 * Require access to seller data: the pipeline and the Deal Room.
 *
 * Deliberately a narrower thing than "is signed in". An investor holds an
 * account and may hold a current certification, and still must never see what a
 * seller reported about their health.
 */
export async function requireOperator(returnTo: string): Promise<Viewer> {
  return requirePermission("view-seller-data", returnTo);
}

/** The account behind the viewer, where one is named. */
export function viewerAccount(viewer: Viewer): Account | undefined {
  return viewer.kind === "account" ? viewer.account : undefined;
}

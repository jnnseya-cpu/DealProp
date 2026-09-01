import Link from "next/link";
import { SiteHeader } from "@/app/components/chrome";
import { SignOutButton } from "@/app/operator/SignOutButton";
import { requirePermission } from "@/app/operator/guard";
import { listAudit, type AuditAction } from "@backend/store/repository";

export const dynamic = "force-dynamic";

export const metadata = { title: "Audit trail — Lode" };

/**
 * The audit trail.
 *
 * The question this exists to answer is asked after something has already gone
 * wrong: who looked at this seller's file, and when. It is append-only in the
 * store — there is no update or delete anywhere in the codebase — because a log
 * that can be edited answers nothing worth asking.
 */
const TONE: Partial<Record<AuditAction, string>> = {
  "sign-in-failed": "text-amber-300",
  "access-denied": "text-red-300",
  "account-disabled": "text-amber-300",
  "viewed-seller-data": "text-ink-200",
  "viewed-deal-material": "text-lode-200",
  "certification-given": "text-emerald-300",
};

export default async function AuditPage() {
  await requirePermission("view-audit-log", "/operator/audit");
  const events = await listAudit({ limit: 300 });

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader
        trailing={
          <nav className="flex items-center gap-6 text-sm text-ink-400">
            <Link href="/deals" className="transition hover:text-ink-100">Deals</Link>
            <Link href="/operator/audit" className="text-ink-100">Audit</Link>
            <SignOutButton />
          </nav>
        }
      />

      <div className="mx-auto max-w-4xl px-6 py-10">
        <span className="eyebrow">
          Audit trail
        </span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {events.length === 0 ? "Nothing recorded yet" : `${events.length} recent events`}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          Append-only. Entries are never updated or deleted, and access taken with the shared
          operator password appears without a name — which is the reason to give people their own
          accounts.
        </p>

        {events.length === 0 ? (
          <p className="mt-10 rounded-2xl border hairline bg-surface-1 px-5 py-6 text-sm text-ink-400">
            No events recorded. Sign in with a named account and open a deal to see entries appear.
          </p>
        ) : (
          <div className="mt-10 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b hairline text-xs uppercase tracking-[0.1em] text-ink-500">
                  <th className="py-2 pr-4 font-normal">When</th>
                  <th className="py-2 pr-4 font-normal">Who</th>
                  <th className="py-2 pr-4 font-normal">Action</th>
                  <th className="py-2 font-normal">Subject</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-ink-800/60 align-top">
                    <td className="tnum py-2.5 pr-4 text-xs text-ink-400">
                      {e.at.replace("T", " ").slice(0, 19)}
                    </td>
                    <td className="py-2.5 pr-4 text-ink-300">
                      {e.email ?? <span className="text-ink-600">shared password</span>}
                    </td>
                    <td className={`py-2.5 pr-4 ${TONE[e.action] ?? "text-ink-300"}`}>
                      {e.action}
                      {e.detail !== undefined && (
                        <span className="block text-xs text-ink-500">{e.detail}</span>
                      )}
                    </td>
                    <td className="py-2.5 font-mono text-xs text-ink-400">{e.subject ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

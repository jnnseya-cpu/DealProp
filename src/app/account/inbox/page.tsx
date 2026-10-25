import { redirect } from "next/navigation";
import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader } from "@/app/components/chrome";
import { currentViewer } from "@/app/operator/guard";
import { listNotificationsForAccount } from "@backend/store/repository";
import type { Severity } from "@shared/domain/notifications";

export const dynamic = "force-dynamic";

export const metadata = { title: "Inbox — Lode" };

/** A notice is a 2px left rule, toned by severity — never a filled box. */
const SEVERITY_RULE: Record<Severity, string> = {
  info: "border-ink-600",
  success: "border-emerald-500/80",
  warning: "border-amber-500/80",
  critical: "border-red-500/80",
};

/**
 * The in-app inbox.
 *
 * Every event, whatever its channel, is recorded here — the one surface that
 * carries them all, because it is a pull surface the account opens rather than
 * a message pushed to them. Read from the notifications the engine wrote; no
 * figure is computed.
 */
export default async function InboxPage() {
  const viewer = await currentViewer();
  if (viewer === undefined) redirect("/operator?next=%2Faccount%2Finbox");
  if (viewer.kind !== "account") {
    redirect("/account/profile");
  }

  const all = await listNotificationsForAccount(viewer.account.id);
  // The inbox is the in-app channel; email/sms rows are delivery logs, not inbox items.
  const items = all.filter((n) => n.channel === "inapp");

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader trailing={<OperatorNav current="/account/inbox" />} />

      <div className="mx-auto max-w-2xl px-6 py-10">
        <span className="eyebrow">Inbox</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px]">
          {items.length === 0 ? "Nothing here yet" : `${items.length} notice${items.length === 1 ? "" : "s"}`}
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-300">
          Everything Lode has told you, in one place. Security notices arrive here whatever your
          other preferences; marketing only ever reaches you with your consent.
        </p>

        {items.length === 0 ? (
          <p className="mt-10 rounded-xl border hairline bg-surface-1 px-5 py-6 text-sm text-ink-400">
            You have no notifications. As your account and any deals progress, updates will appear
            here.
          </p>
        ) : (
          <ul className="mt-8 space-y-3">
            {items.map((n) => {
              return (
                <li
                  key={n.id}
                  className={`border-l-2 bg-surface-1 py-3 pl-4 pr-4 ${SEVERITY_RULE[n.severity]} rounded-r-lg`}
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="text-[14px] text-ink-100">{n.subject}</p>
                    <time className="shrink-0 font-mono text-[11px] text-ink-500" dateTime={n.createdAt}>
                      {n.createdAt.slice(0, 10)}
                    </time>
                  </div>
                  {n.readAt === undefined && (
                    <span className="mt-1 inline-block text-[11px] uppercase tracking-[0.1em] text-lode-300">
                      Unread
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}

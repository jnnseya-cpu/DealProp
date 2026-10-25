import { OperatorNav } from "@/app/operator/OperatorNav";
import { Badge, Panel, SiteHeader, Stat } from "@/app/components/chrome";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { listNotificationsForAccount } from "@backend/store/repository";
import {
  CHANNELS,
  channelCoverage,
  NOTIFICATION_CATALOGUE,
  type LawfulBasis,
  type NotificationEvent,
} from "@shared/domain/notifications";
import { SendTestForm } from "./SendTestForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Comms — Lode" };

const BASIS_TONE: Record<LawfulBasis, "neutral" | "accent" | "warn"> = {
  service: "neutral",
  security: "warn",
  marketing: "accent",
};

/**
 * The communication event centre.
 *
 * Shows the whole catalogue with the one field that governs everything — the
 * lawful basis — and lets an operator fire any event to themselves across its
 * lawful channels, sandboxed when no provider is configured. The routing is the
 * pure core tested in isolation; this is the window onto it.
 */
export default async function NotificationsPage() {
  const viewer = await requirePermission("view-audit-log", "/operator/notifications");
  const account = viewerAccount(viewer);

  const events = Object.values(NOTIFICATION_CATALOGUE);
  const coverage = channelCoverage();
  const mandatory = events.filter((e) => e.lawfulBasis === "security").length;
  const marketing = events.filter((e) => e.lawfulBasis === "marketing").length;

  // Group by category, preserving catalogue order.
  const byCategory = new Map<string, NotificationEvent[]>();
  for (const e of events) {
    const list = byCategory.get(e.category) ?? [];
    list.push(e);
    byCategory.set(e.category, list);
  }

  const recent = account !== undefined ? await listNotificationsForAccount(account.id) : [];

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader trailing={<OperatorNav current="/operator/notifications" />} />

      <div className="mx-auto max-w-4xl px-6 py-10">
        <span className="eyebrow">Comms</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px]">
          Communication events
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          One engine, fanning out across channels. Each event carries a lawful basis, and that
          decides everything: a security notice reaches the account holder regardless, a service
          message stops on an opt-out, and marketing needs recorded consent and never reaches an
          individual by SMS. Email is sandboxed until a provider key is set.
        </p>

        <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4">
          <Stat label="Catalogue events" value={String(events.length)} note={`${byCategory.size} categories`} />
          <Stat label="Security (mandatory)" value={String(mandatory)} note="reach the account holder" />
          <Stat label="Marketing" value={String(marketing)} note="consent only" />
          <Stat label="Channels wired" value={String(CHANNELS.length)} note={CHANNELS.join(" · ")} />
        </dl>

        <Panel className="mt-8" eyebrow="Template QA" title="Fire an event to yourself">
          {account === undefined ? (
            <p className="text-[13px] leading-relaxed text-ink-400">
              You are signed in with the shared password. Sign in with a named account to send a
              test — it needs an inbox and address to go to.
            </p>
          ) : (
            <SendTestForm events={events.map((e) => ({ key: e.key, title: e.title }))} />
          )}
        </Panel>

        <div className="mt-8 space-y-6">
          {[...byCategory.entries()].map(([category, list]) => (
            <section key={category}>
              <h2 className="eyebrow">{category}</h2>
              <ul className="mt-3 overflow-hidden rounded-xl border hairline bg-surface-1">
                {list.map((e) => (
                  <li
                    key={e.key}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b hairline px-4 py-3 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="text-[14px] text-ink-100">{e.title}</p>
                      <p className="font-mono text-[11px] text-ink-500">{e.key}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={BASIS_TONE[e.lawfulBasis]}>{e.lawfulBasis}</Badge>
                      <span className="font-mono text-[11px] text-ink-400">{e.channels.join(" · ")}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {account !== undefined && (
          <Panel className="mt-8" eyebrow="Your account" title="Recent deliveries">
            {recent.length === 0 ? (
              <p className="text-[13px] text-ink-500">Nothing delivered to your account yet.</p>
            ) : (
              <ul className="space-y-2">
                {recent.slice(0, 12).map((n) => (
                  <li
                    key={n.id}
                    className="flex items-baseline justify-between gap-4 border-b hairline py-2 text-[13px] last:border-0"
                  >
                    <span className="text-ink-200">{n.subject}</span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-500">
                      {n.channel} · {n.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </main>
  );
}

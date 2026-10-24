import { OperatorNav } from "@/app/operator/OperatorNav";
import { SiteHeader, Panel, Badge, Stat } from "@/app/components/chrome";
import { requireOperator } from "@/app/operator/guard";
import {
  keyGroups,
  keyStatuses,
  settingsSummary,
  type KeyStatus,
  type ManagedBy,
} from "@backend/settings/catalogue";

export const dynamic = "force-dynamic";

export const metadata = { title: "Configuration — Lode" };

const MANAGED_LABEL: Record<ManagedBy, string> = {
  "env-bootstrap": "Server env · stays here",
  "env-build": "Build argument",
  "env-runtime": "Server env · admin-editable soon",
};

/**
 * Configuration status.
 *
 * Read-only on purpose: it shows which keys are set and which are still
 * missing, so setup can be tracked at a glance, without yet being a place that
 * holds secrets. A value is only ever shown as a hint — the last four of a
 * secret — and the three bootstrap keys are marked as never movable, because
 * they are what reaches, decrypts and gates this very page.
 */
export default async function SettingsPage() {
  await requireOperator("/operator/settings");

  const statuses = keyStatuses();
  const summary = settingsSummary(statuses);
  const groups = keyGroups();
  const byGroup = (group: string): readonly KeyStatus[] => statuses.filter((s) => s.spec.group === group);

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader trailing={<OperatorNav current="/operator/settings" />} />

      <div className="mx-auto max-w-4xl px-6 pt-10">
        <span className="eyebrow">Configuration</span>
        <h1 className="mt-2 font-display text-[26px] leading-tight text-ink-100 sm:text-[30px]">
          What&rsquo;s set, and what&rsquo;s still needed
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-400">
          Every key the platform reads, grouped by what it powers. Keys are
          entered in the server environment for now (see{" "}
          <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px] text-ink-300">docs/LAUNCH-ENV.md</code>); an
          encrypted in-admin editor comes after launch. Secrets are shown only by
          their last four characters, never in full.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-5 sm:grid-cols-3">
          <Stat
            label="Launch-required set"
            value={`${summary.launchSet}/${summary.launchRequired}`}
            warn={!summary.launchReady}
            note={summary.launchReady ? "all set" : "some still missing"}
          />
          <Stat label="Total configured" value={`${summary.totalSet}/${summary.total}`} />
          <div className="flex items-end">
            <Badge tone={summary.launchReady ? "good" : "warn"}>
              {summary.launchReady ? "Launch keys ready" : "Launch keys incomplete"}
            </Badge>
          </div>
        </div>

        <div className="mt-10 space-y-6">
          {groups.map((group) => (
            <Panel key={group} title={group}>
              <div className="-mt-1">
                {byGroup(group).map((status) => (
                  <Row key={status.spec.key} status={status} />
                ))}
              </div>
            </Panel>
          ))}
        </div>
      </div>
    </main>
  );
}

function Row({ status }: { status: KeyStatus }) {
  const { spec, set, hint } = status;
  const badge = set ? (
    <Badge tone="good">Set</Badge>
  ) : spec.blocksLaunch ? (
    <Badge tone="bad">Missing · blocks launch</Badge>
  ) : (
    <Badge tone="warn">Not set</Badge>
  );

  return (
    <div className="flex flex-col gap-1.5 border-b hairline py-3 last:border-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-100">{spec.label}</span>
          <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px] text-ink-400">{spec.key}</code>
        </div>
        <p className="mt-1 text-[12px] leading-snug text-ink-500">{spec.purpose}</p>
        <p className="mt-0.5 text-[11px] text-ink-600">{MANAGED_LABEL[spec.managedBy]}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
        {badge}
        {set && hint !== "" && <span className="tnum font-mono text-[12px] text-ink-400">{hint}</span>}
      </div>
    </div>
  );
}

import { OperatorNav } from "@/app/operator/OperatorNav";
import { Badge, SiteHeader } from "@/app/components/chrome";
import { requireOperator } from "@/app/operator/guard";
import { permissionSet } from "@backend/permissions";
import { PERMISSIONS, heldKeys, type PermissionKey } from "@shared/domain/permissions";
import { FEE_DEFINITIONS } from "@shared/domain/fees";

export const dynamic = "force-dynamic";

export const metadata = { title: "Permissions — Lode" };

/**
 * What the platform is permitted to do, and what each permission switches on.
 *
 * `HELD_PERMISSIONS` is a single environment variable read by the fee engine,
 * the revenue model, the charge gate and the regulatory router. It is also easy
 * to get subtly wrong — a comma inside an evidence value, a typo in a key — and
 * the failure is silent: the fee simply does not switch on. This page is the
 * mirror. It reads the same configuration every engine reads and shows, for
 * each permission, whether it is recorded with evidence and which fees it makes
 * chargeable, so turning a fee on is something you can see rather than guess.
 *
 * It only reports. Nothing here records a permission — that is a deliberate
 * decision made in configuration, because an income stream switched on from a
 * web form is an income stream switched on by whoever reached the form.
 */
export default async function PermissionsPage() {
  await requireOperator("/operator/permissions");

  const set = permissionSet();
  const held = new Set<PermissionKey>(heldKeys(set));
  const evidenceFor = new Map(set.held.map((h) => [h.key, h.evidence]));

  const fees = FEE_DEFINITIONS.map((fee) => {
    const missing = fee.requiresPermissions.filter((k) => !held.has(k));
    return { fee, chargeable: missing.length === 0, missing };
  });
  const liveCount = fees.filter((f) => f.chargeable).length;

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader trailing={<OperatorNav current="/operator/permissions" />} />

      <div className="mx-auto max-w-4xl px-6 py-10">
        <span className="eyebrow">Permissions</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px] sm:leading-[1.12]">
          {set.held.length} recorded · {liveCount} of {fees.length} fees live
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          Read from the <code className="font-mono text-[13px] text-ink-200">HELD_PERMISSIONS</code>{" "}
          environment variable — the one source the fee engine, revenue model and regulatory router
          all read. To change what is recorded, edit that variable in the server environment and
          restart; nothing here can grant a permission, by design.
        </p>

        {(set.unevidenced.length > 0 || set.unrecognised.length > 0) && (
          <div className="mt-6 rounded-lg border-l-2 border-amber-500/80 bg-surface-1 px-5 py-4 text-sm leading-relaxed text-ink-200">
            <p className="font-medium text-amber-300">Configuration needs a look</p>
            {set.unevidenced.length > 0 && (
              <p className="mt-2">
                Named without evidence, so granting nothing:{" "}
                <span className="font-mono text-[13px] text-ink-100">{set.unevidenced.join(", ")}</span>. A
                permission needs a <span className="text-ink-100">key:evidence</span> pair — a common cause
                is a comma inside an evidence value, which splits the entry in two.
              </p>
            )}
            {set.unrecognised.length > 0 && (
              <p className="mt-2">
                Not a recognised permission key:{" "}
                <span className="font-mono text-[13px] text-ink-100">{set.unrecognised.join(", ")}</span>.
              </p>
            )}
          </div>
        )}

        <section className="mt-10 space-y-3">
          {PERMISSIONS.map((p) => {
            const isHeld = held.has(p.key);
            const gatedFees = FEE_DEFINITIONS.filter((f) => f.requiresPermissions.includes(p.key));
            return (
              <div
                key={p.key}
                className={`rounded-2xl border px-5 py-4 ${isHeld ? "hairline bg-surface-1" : "border-ink-800 bg-ink-950/50"}`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-display text-lg text-ink-100">{p.label}</span>
                  <Badge tone={isHeld ? "good" : p.criminal ? "warn" : "neutral"}>
                    {isHeld ? "Recorded" : "Not recorded"}
                  </Badge>
                  {p.criminal && !isHeld && (
                    <span className="font-mono text-[10px] uppercase tracking-wider text-amber-300/80">
                      Offence to act without it
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[11px] text-ink-500">{p.regulator}</span>
                </div>

                <p className="mt-2 text-[13px] leading-relaxed text-ink-300">{p.authorises}</p>

                {isHeld ? (
                  <p className="mt-2 font-mono text-[11px] text-emerald-300/80">
                    {p.evidenceLabel}: {evidenceFor.get(p.key)}
                  </p>
                ) : (
                  <p className="mt-2 font-mono text-[11px] text-ink-500">
                    To record: <span className="text-ink-300">{p.key}:&lt;{p.evidenceLabel}&gt;</span>
                  </p>
                )}

                {gatedFees.length > 0 && (
                  <p className="mt-2 text-[12px] leading-relaxed text-ink-400">
                    Gates:{" "}
                    {gatedFees.map((f, i) => (
                      <span key={f.key}>
                        {i > 0 ? ", " : ""}
                        <span className={isHeld ? "text-ink-200" : "text-ink-500"}>{f.label}</span>
                      </span>
                    ))}
                    .
                  </p>
                )}
              </div>
            );
          })}
        </section>

        <section className="mt-12">
          <h2 className="eyebrow">Fees</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-400">
            What may be charged right now, and what each one is still waiting on. A fee is live only
            when every permission it needs is recorded with evidence.
          </p>
          <ul className="mt-4 space-y-2">
            {fees.map(({ fee, chargeable, missing }) => (
              <li
                key={fee.key}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border hairline bg-surface-1 px-4 py-3"
              >
                <div className="min-w-0">
                  <span className="text-sm text-ink-100">{fee.label}</span>
                  <span className="ml-2 text-[12px] text-ink-500">{fee.basis}</span>
                </div>
                {chargeable ? (
                  <Badge tone="good">Live</Badge>
                ) : (
                  <span className="shrink-0 text-[11px] text-amber-300/80">
                    needs {missing.join(" + ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";

/**
 * The footer's statutory identity block, filled at runtime.
 *
 * It fetches /api/identity (runtime, public) rather than reading process.env at
 * render, so a statically prerendered page shows the live, configured company
 * details instead of the build-time emptiness that produced a false "not
 * configured" warning. It renders nothing until the fetch resolves — so the
 * warning only ever appears if the identity is genuinely unset at runtime, which
 * is the one case it is meant for.
 */

interface Identity {
  readonly registration: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly registeredOffice: string | null;
  readonly icoRegistration: string | null;
  readonly amlSupervision: string | null;
  readonly redressScheme: string | null;
  readonly blockingGaps: readonly string[];
  readonly feeStatement: string;
}

export function FooterIdentity() {
  const [id, setId] = useState<Identity | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/identity", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? (r.json() as Promise<Identity>) : null))
      .then((data) => {
        if (live && data !== null) setId(data);
      })
      .catch(() => {
        /* leave the block empty rather than showing a false warning */
      });
    return () => {
      live = false;
    };
  }, []);

  // Nothing until we know the real, runtime answer.
  if (id === null) return <div className="mt-9 border-t hairline pt-6" />;

  return (
    <div className="mt-9 border-t hairline pt-6 text-[12px] leading-[1.7] text-ink-500">
      {id.registration !== null ? (
        <p>{id.registration}</p>
      ) : (
        <p className="text-amber-300">
          Company identity has not been configured. Set the company details in the environment —
          the registered name, number, place of registration and registered office are required on
          every page by the Companies Act 2006 s.82.
        </p>
      )}

      {(id.contactEmail !== null || id.contactPhone !== null || id.registeredOffice !== null) && (
        <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
          {id.contactEmail !== null && (
            <a href={`mailto:${id.contactEmail}`} className="transition-colors hover:text-ink-200">
              {id.contactEmail}
            </a>
          )}
          {id.contactPhone !== null && (
            <a
              href={`tel:${id.contactPhone.replace(/\s/g, "")}`}
              className="transition-colors hover:text-ink-200"
            >
              {id.contactPhone}
            </a>
          )}
          {id.registeredOffice !== null && <span>{id.registeredOffice}</span>}
        </p>
      )}

      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {id.icoRegistration !== null && <li>ICO registration {id.icoRegistration}</li>}
        {id.amlSupervision !== null && (
          <li>HMRC anti-money-laundering supervision {id.amlSupervision}</li>
        )}
        {id.redressScheme !== null && <li>{id.redressScheme}</li>}
      </ul>

      {id.blockingGaps.length > 0 && id.registration !== null && (
        <p className="mt-2 text-amber-300">
          {id.blockingGaps.length} statutory disclosure{id.blockingGaps.length === 1 ? "" : "s"}{" "}
          still unrecorded: {id.blockingGaps.map((g) => g.toLowerCase()).join(", ")}.
        </p>
      )}

      <p className="mt-4 max-w-3xl">
        Figures shown anywhere on this site are screening estimates produced by an engine, not advice,
        not a valuation and not an offer. Tax figures always require professional review. {id.feeStatement}
      </p>
    </div>
  );
}

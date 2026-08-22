"use client";

import { useState } from "react";
import { setAccountEnabled } from "./actions";

/**
 * Disable and re-enable. Never delete: the audit trail refers to accounts by
 * id, and removing one would leave entries pointing at nobody.
 */
export function AccountControls({ id, disabled }: { id: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void setAccountEnabled(id, disabled).finally(() => setBusy(false));
      }}
      className="rounded-lg border hairline px-3 py-1.5 text-xs text-ink-300 transition hover:border-lode-400/40 hover:text-lode-200 disabled:opacity-50"
    >
      {disabled ? "Re-enable" : "Disable"}
    </button>
  );
}

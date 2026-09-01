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
      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border hairline bg-surface-2 px-3 text-[13px] text-ink-200 transition-colors hover:border-ink-600 hover:text-ink-100"
    >
      {disabled ? "Re-enable" : "Disable"}
    </button>
  );
}

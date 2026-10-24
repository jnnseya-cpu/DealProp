import { describe, expect, it } from "vitest";
import {
  REQUIRED_KEYS,
  keyStatuses,
  settingsSummary,
} from "../src/backend/settings/catalogue";

/**
 * The status view is read-only and must stay that way: it may show that a
 * secret is set, and its last four characters, but never the secret itself.
 */

describe("settings catalogue", () => {
  it("never surfaces a whole secret, only its last four characters", () => {
    const env: Record<string, string> = {};
    for (const spec of REQUIRED_KEYS) env[spec.key] = `${spec.key}_VALUE_abcd1234`;
    const statuses = keyStatuses(env);

    for (const status of statuses) {
      expect(status.set).toBe(true);
      if (status.spec.secret) {
        // The whole value never appears; only its last four, behind a mask.
        expect(status.hint).not.toContain("abcd1234");
        expect(status.hint).toBe("••••1234");
      } else {
        // Non-secret config is shown (useful, and not sensitive).
        expect(status.hint).toContain("1234");
      }
    }
  });

  it("reports a key as missing when unset or blank", () => {
    const statuses = keyStatuses({ OPERATOR_SECRET: "", DATABASE_URL: "   " });
    for (const status of statuses) {
      expect(status.set).toBe(false);
      expect(status.hint).toBe("");
    }
  });

  it("counts the launch-required keys and whether they are all set", () => {
    const empty = settingsSummary(keyStatuses({}));
    expect(empty.launchRequired).toBeGreaterThan(0);
    expect(empty.launchSet).toBe(0);
    expect(empty.launchReady).toBe(false);

    const launchKeys = REQUIRED_KEYS.filter((s) => s.blocksLaunch);
    const env = Object.fromEntries(launchKeys.map((s) => [s.key, "x"]));
    const ready = settingsSummary(keyStatuses(env));
    expect(ready.launchSet).toBe(ready.launchRequired);
    expect(ready.launchReady).toBe(true);
  });

  it("keeps the three bootstrap keys unmovable from the environment", () => {
    const bootstrap = REQUIRED_KEYS.filter((s) => s.managedBy === "env-bootstrap").map((s) => s.key);
    expect(bootstrap).toEqual(
      expect.arrayContaining(["OPERATOR_SECRET", "DATA_ENCRYPTION_KEY", "DATABASE_URL"]),
    );
    // None of the bootstrap keys is ever marked admin-editable.
    for (const spec of REQUIRED_KEYS) {
      if (["OPERATOR_SECRET", "DATA_ENCRYPTION_KEY", "DATABASE_URL"].includes(spec.key)) {
        expect(spec.managedBy).toBe("env-bootstrap");
      }
    }
  });
});

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Reading the environment the way the running app reads it.
 *
 * The preflight used `process.env` directly, which meant a deployment
 * configured entirely correctly in `.env.local` — the file Next itself loads —
 * still reported nine blockers. A release gate that fails a correct
 * configuration is a release gate people learn to override, and an overridden
 * gate stops nothing at all.
 *
 * Precedence follows Next's, and the reason for each step matters:
 *
 *  1. **A real environment variable always wins.** On a host, the platform's
 *     own configuration is the truth, and a stray `.env` file in a container
 *     image must not be able to quietly replace a production secret.
 *  2. **`.env.local` beats `.env`.** The first is the machine's own, gitignored
 *     and holding secrets; the second is checked in and holds defaults.
 *
 * Deliberately a small hand-rolled reader rather than a dependency. The format
 * this needs is `KEY=value` with comments and optional quotes, and adding a
 * package to a release gate widens the supply chain of the one script whose
 * job is to be trustworthy.
 */

/** Files, least specific first. Later files do not override earlier ones. */
const FILES = [".env.local", ".env"] as const;

export interface LoadedEnv {
  readonly env: Record<string, string | undefined>;
  /** Which files were actually found, in the order they were read. */
  readonly sources: readonly string[];
}

/**
 * Parse `KEY=value` lines.
 *
 * Quotes are stripped because a value with a space in it — a registered office
 * address, most obviously — has to be quotable. `export KEY=` is accepted
 * because people paste from shell scripts. A line without `=` is skipped
 * rather than guessed at.
 */
export function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;

    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1);
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      // An unquoted trailing comment is a comment. A quoted one is part of the
      // value, which is why this only runs on unquoted values.
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trimEnd();
    }

    values[key] = value;
  }

  return values;
}

/** Read the env files a Next deployment would, without overriding the real one. */
export function loadEnv(
  root: string = process.cwd(),
  // A plain record rather than NodeJS.ProcessEnv: this only ever reads keys,
  // and the narrower type would force every caller to carry NODE_ENV.
  base: Readonly<Record<string, string | undefined>> = process.env,
): LoadedEnv {
  const merged: Record<string, string | undefined> = { ...base };
  const sources: string[] = [];

  for (const file of FILES) {
    const full = path.join(root, file);
    if (!existsSync(full)) continue;
    sources.push(file);

    for (const [key, value] of Object.entries(parseEnvFile(readFileSync(full, "utf8")))) {
      // Never overwrite. A real variable wins over any file, and the first
      // file to define a key wins over later ones.
      if (merged[key] === undefined || merged[key] === "") merged[key] = value;
    }
  }

  return { env: merged, sources };
}

/**
 * Put the loaded values into `process.env`.
 *
 * Necessary because the preflight does not only read values — it imports the
 * modules that read them. The store reads `DATABASE_URL` at import time, the
 * billing provider reads its keys, and none of them takes an environment as an
 * argument. Loading a file into a local object and leaving `process.env`
 * untouched produced exactly the confusion this whole change exists to remove:
 * the identity checks passed from the file while the Postgres reachability
 * check reported "DATABASE_URL is not set", because it was asking a different
 * environment.
 *
 * Never overwrites. A real variable is the truth and this only fills gaps, so
 * calling it cannot change what a host has configured.
 */
export function applyEnv(loaded: LoadedEnv): void {
  for (const [key, value] of Object.entries(loaded.env)) {
    if (value === undefined) continue;
    if (process.env[key] !== undefined && process.env[key] !== "") continue;
    process.env[key] = value;
  }
}

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { applyEnv, loadEnv } from "./env";

/**
 * Take a backup.
 *
 * `docs/GO-LIVE.md` said to take one before any non-additive change and
 * nothing in the repository took one. A runbook instruction with no command
 * behind it is an instruction somebody skips at exactly the moment it matters,
 * which is late at night with a migration half-applied.
 *
 * Deliberately thin. This shells out to `pg_dump` rather than reimplementing
 * it: the tool that ships with the database is the one that understands its
 * own version, and a hand-rolled exporter is a hand-rolled restorer waiting to
 * be discovered not to work.
 *
 * Two things it will not do. It will not back up the JSON file store, because
 * that store is a development convenience and copying a file is not a skill
 * this needs to teach. And it will not restore — restoring is the dangerous
 * direction and belongs in a human's hands with the runbook open, not behind
 * an npm script somebody could run with the wrong argument.
 *
 * Usage: npm run backup [-- <directory>]
 */

function main(): void {
  applyEnv(loadEnv());

  const url = process.env.DATABASE_URL ?? "";
  if (url === "") {
    process.stderr.write(
      "DATABASE_URL is not set, so there is no database to back up. The JSON file store is a " +
        "development convenience; copy the file if you want a copy of it.\n",
    );
    process.exitCode = 1;
    return;
  }

  const directory = process.argv[2] ?? "backups";
  mkdirSync(directory, { recursive: true });

  // Colons are legal in a filename on Linux and a problem everywhere else, and
  // a backup that cannot be copied to a laptop is a backup nobody checks.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(directory, `lode-${stamp}.dump`);

  // Custom format: compressed, and restorable selectively with pg_restore.
  // A plain SQL dump of this database is large and can only be replayed whole.
  const child = spawn("pg_dump", ["--format=custom", "--no-owner", "--file", file, url], {
    stdio: ["ignore", "inherit", "inherit"],
  });

  child.on("error", (error) => {
    process.stderr.write(
      `Could not run pg_dump: ${error.message}\nInstall the client tools matching your server's major version.\n`,
    );
    process.exitCode = 1;
  });

  child.on("exit", (code) => {
    if (code === 0) {
      process.stdout.write(`Wrote ${file}\n`);
      process.stdout.write(
        "Restore with: pg_restore --clean --if-exists --no-owner --dbname \"$DATABASE_URL\" " +
          `${file}\n\nA backup nobody has restored is a hypothesis. Restore this one into a ` +
          "scratch database before you need it to work.\n",
      );
      return;
    }
    process.stderr.write(`pg_dump exited ${String(code)}. Nothing was written.\n`);
    process.exitCode = 1;
  });
}

main();

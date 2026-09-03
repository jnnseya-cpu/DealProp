import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyEnv, loadEnv, parseEnvFile } from "../scripts/env";

/**
 * Reading the environment the way the running app reads it.
 *
 * The defect this fixes: a deployment configured entirely correctly in
 * `.env.local` — the file Next itself loads — reported nine blockers, because
 * the preflight read `process.env` and `tsx` loads no env files. A release gate
 * that fails a correct configuration is a release gate somebody overrides, and
 * an overridden gate stops nothing at all.
 */

const SCRATCH = mkdtempSync(path.join(tmpdir(), "lode-env-"));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

function write(file: string, contents: string): void {
  writeFileSync(path.join(SCRATCH, file), contents);
}

describe("parsing", () => {
  it("reads plain pairs and ignores comments and blanks", () => {
    expect(
      parseEnvFile(["# a comment", "", "OPERATOR_SECRET=abc123", "  CRON_SECRET=def456  "].join("\n")),
    ).toEqual({ OPERATOR_SECRET: "abc123", CRON_SECRET: "def456" });
  });

  it("keeps a quoted value whole, because an address has spaces in it", () => {
    const parsed = parseEnvFile('COMPANY_REGISTERED_OFFICE="1 Example Street, Birmingham, B1 1AA"');
    expect(parsed.COMPANY_REGISTERED_OFFICE).toBe("1 Example Street, Birmingham, B1 1AA");
  });

  it("strips a trailing comment from an unquoted value but not a quoted one", () => {
    expect(parseEnvFile("SITE=https://lode.example # the origin").SITE).toBe("https://lode.example");
    // A hash inside quotes is part of the value. Some secrets contain one.
    expect(parseEnvFile('KEY="abc # def"').KEY).toBe("abc # def");
  });

  it("accepts a line pasted from a shell script", () => {
    expect(parseEnvFile("export OPERATOR_SECRET=abc").OPERATOR_SECRET).toBe("abc");
  });

  it("skips a line it cannot read rather than guessing at it", () => {
    expect(parseEnvFile(["not a pair", "=novalue", "1BAD=x", "GOOD=y"].join("\n"))).toEqual({
      GOOD: "y",
    });
  });

  it("keeps an empty value, because set-and-blank is a real state", () => {
    // The scaffold writes blank keys deliberately, and a reader that dropped
    // them would make "you have not filled this in" indistinguishable from
    // "this key does not exist".
    expect(parseEnvFile("COMPANY_NUMBER=")).toEqual({ COMPANY_NUMBER: "" });
  });
});

describe("applying to process.env", () => {
  it("fills a gap so a module that reads process.env itself can see it", () => {
    // The preflight does not only read values, it imports the modules that
    // read them: the store reads DATABASE_URL at import and takes no argument.
    // Without this, the identity checks passed from the file while the
    // Postgres reachability check reported "DATABASE_URL is not set".
    const key = "LODE_TEST_APPLY_GAP";
    delete process.env[key];
    applyEnv({ env: { [key]: "from-file" }, sources: [".env.local"] });
    expect(process.env[key]).toBe("from-file");
    delete process.env[key];
  });

  it("never overwrites what the host already set", () => {
    const key = "LODE_TEST_APPLY_KEEP";
    process.env[key] = "from-the-host";
    applyEnv({ env: { [key]: "from-file" }, sources: [".env.local"] });
    expect(process.env[key]).toBe("from-the-host");
    delete process.env[key];
  });

  it("treats a blank host value as a gap to fill", () => {
    const key = "LODE_TEST_APPLY_BLANK";
    process.env[key] = "";
    applyEnv({ env: { [key]: "from-file" }, sources: [] });
    expect(process.env[key]).toBe("from-file");
    delete process.env[key];
  });
});

describe("precedence", () => {
  it("lets a real environment variable win over any file", () => {
    // On a host the platform's own configuration is the truth. A stray .env in
    // a container image must not be able to replace a production secret.
    write(".env.local", "OPERATOR_SECRET=from-file");
    const { env } = loadEnv(SCRATCH, { OPERATOR_SECRET: "from-the-host" });
    expect(env.OPERATOR_SECRET).toBe("from-the-host");
  });

  it("lets .env.local win over .env", () => {
    // The first is the machine's own and holds secrets; the second is checked
    // in and holds defaults.
    write(".env.local", "SITE=local");
    write(".env", "SITE=committed\nONLY_IN_ENV=yes");
    const { env } = loadEnv(SCRATCH, {});
    expect(env.SITE).toBe("local");
    expect(env.ONLY_IN_ENV).toBe("yes");
  });

  it("treats an empty real variable as unset, so a file can fill it", () => {
    // A host that exports a key with no value has not configured it, and
    // treating that as configured is how a blank secret reaches production.
    write(".env.local", "OPERATOR_SECRET=from-file");
    const { env } = loadEnv(SCRATCH, { OPERATOR_SECRET: "" });
    expect(env.OPERATOR_SECRET).toBe("from-file");
  });

  it("reports which files it actually read", () => {
    const { sources } = loadEnv(SCRATCH, {});
    expect(sources).toEqual([".env.local", ".env"]);
    expect(loadEnv(mkdtempSync(path.join(tmpdir(), "lode-empty-")), {}).sources).toEqual([]);
  });
});
